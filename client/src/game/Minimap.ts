import {
  BOSS_ARENA_CENTER,
  BOSS_ARENA_RADIUS,
  computeHexTerrainGrid,
  DUNGEON_HALF_EXTENT,
  DUNGEON_PORTALS,
  dungeonHexContent,
  HexCellPlacement,
  HexTerrainKind,
  HEX_CIRCUMRADIUS,
  MAP_HALF_EXTENT,
  NPCS,
  STRUCTURES,
  WAYPOINTS,
  WaypointDef,
} from "@mmo/shared";
import { QuestIndicatorState } from "./Npc";

// World-unit radius shown from the player (center) to the edge of the small radar - independent
// of MAP_HALF_EXTENT, since a player-centered view (not a full static map) is what stays readable
// once the overworld is hundreds of units across. WoW-style: north-up, not rotated with the
// camera, since the camera itself never orbits (see Scene.ts's CAMERA_PITCH comment). The big map
// (see isBigMap below) uses the actual map half-extent instead, so it shows everything at once.
const VIEW_RADIUS = 70;
const BIG_MAP_MARGIN = 1.05; // small margin so landmarks right at the map edge aren't clipped

const COLOR_SELF = "#ffffff";
const COLOR_NPC = "#f5d76e";
const COLOR_VENDOR_NPC = "#4fd166";
const COLOR_STRUCTURE = "#8a95b8";
const COLOR_PORTAL = "#b06fe0";
const COLOR_WAYPOINT = "#3ddbd9";
const COLOR_WAYPOINT_LINK = "rgba(61, 219, 217, 0.45)"; // travel picker only - see drawWaypointTravelOverlay
const COLOR_WAYPOINT_CURRENT = "#fff2d9"; // "you are here" highlight, distinct from every destination's teal dot
const COLOR_BOSS_ARENA = "rgba(224, 90, 78, 0.25)";
const COLOR_RING = "#4a5578";
const COLOR_QUEST_AREA = "rgba(255, 210, 63, 0.18)";
const COLOR_QUEST_AREA_BORDER = "#ffd23f";
// Matches NpcAvatar's in-world "!"/"?" indicator palette (Npc.ts's COLOR_AVAILABLE/ACTIVE/READY)
// so a quest giver reads the same way on the map as it does when you're standing next to them.
const COLOR_QUEST_AVAILABLE = "#ffd200";
const COLOR_QUEST_ACTIVE = "#9099ab";
const COLOR_QUEST_READY = "#ffd200";

// One flat color per HexTerrainKind for the minimap's own top-down tile fill - approximate, not a
// palette-matched sample of the real 3D textures (see HexGround.ts/textures.ts), just distinct
// enough at minimap scale to read as grass/water/road/river/shoreline. The 4 coast tiers all get
// the same sandy tone - the minimap has no use for their otherwise-only-relevant-up-close
// difference in exactly how much sand vs. water each one shows.
const HEX_KIND_COLOR: Record<HexTerrainKind, string> = {
  grass: "#3d6b3d",
  water: "#2f5f8a",
  road: "#8a7355",
  river: "#3d7fae",
  coastCornerLight: "#c2b280",
  coastNarrowEdge: "#c2b280",
  coastHalf: "#c2b280",
  coastMostly: "#c2b280",
};

// A tracked quest's objective area - see main.ts's computeQuestAreaMarkers, which derives this
// from SPAWN_POINTS (a quest has no location of its own, only an enemy type; this is a bounding
// circle over wherever that type actually spawns). `number` matches the same quest's badge in
// the quest log/NPC dialogue (see index.html's .quest-number), so "quest 3" means the same thing
// everywhere it's shown.
export interface QuestAreaMarker {
  x: number;
  z: number;
  radius: number;
  number: number;
}

export class Minimap {
  // Not readonly - renderTerrainIfNeeded temporarily redirects this to an offscreen cache
  // canvas's own context so drawHexTerrain's existing this.ctx-based drawing can populate that
  // cache without needing every helper method threaded with an explicit ctx parameter.
  private ctx: CanvasRenderingContext2D;
  // Only meaningful for the big map (see renderTerrainIfNeeded) - the small radar's viewCenter
  // changes every single frame (it always follows the player), so a cache keyed on viewCenter
  // would invalidate every frame there anyway; VIEW_RADIUS's own culling already keeps that case
  // cheap without needing this. The big map's pan/zoom, by contrast, only change on deliberate
  // user input, so redrawing its terrain (thousands of individual hex fills at whole-map zoom -
  // confirmed ~20ms/frame in a real Canvas2D benchmark, enough alone to blow a 16.6ms/frame budget)
  // on every animation frame while the panel just sits there was pure waste.
  private terrainCacheCanvas: HTMLCanvasElement | null = null;
  private terrainCacheCtx: CanvasRenderingContext2D | null = null;
  private terrainCacheKey = "";
  // Computed once (not per-frame - see HexGround.ts's own buildHexGround, which this mirrors) and
  // reused across every update() call. Keyed by the halfExtent it was computed for so it
  // self-corrects the one time this matters in practice: the very first frame(s) can run before
  // loadGameContent() has resolved and replaced MAP_HALF_EXTENT's placeholder default with the
  // active map's real value - ensureHexGrid notices the mismatch and recomputes.
  private hexGrid: HexCellPlacement[] | null = null;
  private hexGridHalfExtent = 0;
  // Same idea, kept as a separate cache (not reused/keyed together with hexGrid above) since a
  // dungeon's content can change independently of its halfExtent - see ensureDungeonHexGrid.
  private dungeonHexGrid: HexCellPlacement[] | null = null;
  private dungeonHexGridHalfExtent = 0;
  // Set fresh at the top of every update() call - project()/dot()/fillWithTile() all read these
  // instead of threading center/radius/canvas-size through every call site. Canvas width/height
  // are read live off the element rather than cached, so a resizable canvas (see the big map's
  // resize handle, wired in main.ts via ResizeObserver) just works without any extra plumbing.
  private viewCenter = { x: 0, z: 0 };
  private viewRadius = VIEW_RADIUS;
  private width = 0;
  private height = 0;
  private scale = 1; // canvas pixels per world unit - uniform on both axes, see update()

  // Only meaningful for the big map (see pan/zoomBy/resetView below) - the small radar always
  // recenters on the player every frame (viewCenter = self in update()), so pan/zoom would just
  // fight that. panCenter is the world point the big map is currently centered on, defaulting to
  // the map's own center; zoomFactor >1 shows less world at once (zoomed in) - see MIN_ZOOM/
  // MAX_ZOOM. Driven from main.ts's own mouse listeners on the big map's canvas.
  private panCenter = { x: 0, z: 0 };
  private zoomFactor = 1;
  private static readonly MIN_ZOOM = 1; // 1 = the default "whole map" fit, never zoom out further
  private static readonly MAX_ZOOM = 6;

  constructor(
    canvas: HTMLCanvasElement,
    // The "press M" full map: fixed on the world/map center instead of following the player, at
    // a radius wide enough to show the whole map at once, and not clipped to a circle - the small
    // radar and the big map are otherwise identical, just two instances over different canvases.
    private readonly isBigMap = false,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  // Slides the view by a screen-pixel drag delta (canvas backing-resolution pixels, same units
  // project() works in - see main.ts's own devicePixelRatio conversion before calling this).
  // Subtracting (not adding) the delta/scale is what makes the map content visually follow the
  // cursor - project()'s own worldX -> pixelX formula means decreasing viewCenter.x shifts
  // everything's projected pixel to the right, so a rightward drag needs viewCenter.x to decrease
  // by exactly the dragged distance in world units.
  pan(dxPixels: number, dzPixels: number) {
    if (this.scale <= 0) return;
    this.panCenter.x -= dxPixels / this.scale;
    this.panCenter.z -= dzPixels / this.scale;
  }

  // Multiplies the current zoom by `factor` (>1 zooms in, <1 zooms out), keeping the world point
  // under (cursorPxX, cursorPxY) fixed on screen - the standard "zoom toward the cursor" map
  // interaction, rather than always zooming toward the view's current center. Coordinates are
  // canvas-relative backing-resolution pixels, matching pan()'s own convention.
  zoomBy(factor: number, cursorPxX: number, cursorPxY: number) {
    if (this.scale <= 0) return;
    const worldX = this.panCenter.x + (cursorPxX - this.width / 2) / this.scale;
    const worldZ = this.panCenter.z + (cursorPxY - this.height / 2) / this.scale;

    const newZoom = Math.min(Minimap.MAX_ZOOM, Math.max(Minimap.MIN_ZOOM, this.zoomFactor * factor));
    if (newZoom === this.zoomFactor) return; // already clamped at a limit
    const newScale = this.scale * (newZoom / this.zoomFactor);
    this.zoomFactor = newZoom;

    this.panCenter.x = worldX - (cursorPxX - this.width / 2) / newScale;
    this.panCenter.z = worldZ - (cursorPxY - this.height / 2) / newScale;
  }

  // Back to the default "whole map, centered" view - called from main.ts whenever the big map
  // panel is (re)opened, so a pan/zoom from a previous session doesn't leave the player looking at
  // an unexplained corner of the map the next time they press M.
  resetView() {
    this.panCenter = { x: 0, z: 0 };
    this.zoomFactor = 1;
  }

  private project(worldX: number, worldZ: number): [number, number] {
    return [this.width / 2 + (worldX - this.viewCenter.x) * this.scale, this.height / 2 + (worldZ - this.viewCenter.z) * this.scale];
  }

  // See hexGrid's own doc comment - computed once per distinct halfExtent, not per frame.
  // computeHexTerrainGrid is the same classifier HexGround.ts's real 3D ground uses, so the
  // minimap always agrees with what's actually underfoot instead of drawing an unrelated pattern.
  private ensureHexGrid(): HexCellPlacement[] {
    if (!this.hexGrid || this.hexGridHalfExtent !== MAP_HALF_EXTENT) {
      this.hexGrid = computeHexTerrainGrid(MAP_HALF_EXTENT);
      this.hexGridHalfExtent = MAP_HALF_EXTENT;
    }
    return this.hexGrid;
  }

  // Mirrors ensureHexGrid above, but against the active dungeon's own content (dungeonHexContent -
  // types.ts) instead of the live overworld one - dungeon coordinates numerically overlap the
  // overworld's, so this must never fall through to the live/uncontented path.
  private ensureDungeonHexGrid(): HexCellPlacement[] {
    if (!this.dungeonHexGrid || this.dungeonHexGridHalfExtent !== DUNGEON_HALF_EXTENT) {
      this.dungeonHexGrid = computeHexTerrainGrid(DUNGEON_HALF_EXTENT, dungeonHexContent());
      this.dungeonHexGridHalfExtent = DUNGEON_HALF_EXTENT;
    }
    return this.dungeonHexGrid;
  }

  // A flat-shaded pointy-top hexagon, matching the real hex grid's own orientation (see
  // shared/src/hex.ts's hexToWorld) - cells outside the current view are skipped before this is
  // even called (see the caller), so this never runs more times than there are visible tiles.
  private drawHexTile(worldX: number, worldZ: number, color: string) {
    const [px, py] = this.project(worldX, worldZ);
    const radiusPx = HEX_CIRCUMRADIUS * this.scale;
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 90); // first vertex straight up, matching pointy-top
      const vx = px + radiusPx * Math.cos(angle);
      const vy = py + radiusPx * Math.sin(angle);
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawHexTerrain(grid: HexCellPlacement[]) {
    // A small margin beyond the view radius so a tile whose center just crossed out of view but
    // whose visible edge still overlaps it doesn't pop out one frame too early.
    const cullRadius = this.viewRadius + HEX_CIRCUMRADIUS;
    const cullRadiusSq = cullRadius * cullRadius;
    for (const cell of grid) {
      const dx = cell.x - this.viewCenter.x;
      const dz = cell.z - this.viewCenter.z;
      if (dx * dx + dz * dz > cullRadiusSq) continue;
      this.drawHexTile(cell.x, cell.z, HEX_KIND_COLOR[cell.kind]);
    }
  }

  // The big map's own terrain layer (backdrop + every hex fill + darken pass), rendered once into
  // an offscreen canvas and reused every frame the view (center/scale/size) hasn't actually
  // changed - see this.terrainCacheCanvas's own doc comment for why this only applies when
  // this.isBigMap. Redirects this.ctx to the cache's own context for the duration of the draw so
  // drawHexTerrain/drawHexTile need no changes to target it, then restores the live one.
  private renderTerrainIfNeeded(grid: HexCellPlacement[]): HTMLCanvasElement {
    const key = `${this.viewCenter.x.toFixed(2)},${this.viewCenter.z.toFixed(2)},${this.scale.toFixed(5)},${this.width}x${this.height},${grid.length}`;
    if (this.terrainCacheCanvas && this.terrainCacheKey === key) return this.terrainCacheCanvas;

    if (!this.terrainCacheCanvas || this.terrainCacheCanvas.width !== this.width || this.terrainCacheCanvas.height !== this.height) {
      this.terrainCacheCanvas = document.createElement("canvas");
      this.terrainCacheCanvas.width = this.width;
      this.terrainCacheCanvas.height = this.height;
      this.terrainCacheCtx = this.terrainCacheCanvas.getContext("2d")!;
    }

    const liveCtx = this.ctx;
    this.ctx = this.terrainCacheCtx!;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = "rgba(16, 18, 26, 0.9)";
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.drawHexTerrain(grid);
    this.ctx.fillStyle = "rgba(10, 10, 16, 0.35)";
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx = liveCtx;

    this.terrainCacheKey = key;
    return this.terrainCacheCanvas;
  }

  private dot(worldX: number, worldZ: number, color: string, radius: number) {
    const [px, py] = this.project(worldX, worldZ);
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  // Drawn above the NPC's own dot (see the caller) rather than replacing it, so the dot still
  // marks the NPC's exact position underneath. "ready" and "available" share a glyph ("!"/"?" is
  // the giver's own concern, not the map's - see Npc.ts's setQuestIndicator) but this only needs
  // the color to distinguish them, since ready always implies the player already has this quest.
  private questIcon(worldX: number, worldZ: number, state: QuestIndicatorState, dotRadius: number, dotScale: number) {
    if (state === "none") return;
    const [px, py] = this.project(worldX, worldZ);
    const glyph = state === "available" ? "!" : "?";
    const color = state === "available" ? COLOR_QUEST_AVAILABLE : state === "ready" ? COLOR_QUEST_READY : COLOR_QUEST_ACTIVE;
    const iconY = py - dotRadius - 5 * dotScale;

    const ctx = this.ctx;
    ctx.font = `800 ${13 * dotScale}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3 * dotScale;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.strokeText(glyph, px, iconY);
    ctx.fillStyle = color;
    ctx.fillText(glyph, px, iconY);
  }

  // Small stroked-outline label, same stroke+fill legibility trick questIcon uses above - drawn
  // under a dot rather than over it so it never covers the marker itself.
  private waypointLabel(worldX: number, worldZ: number, text: string, dotRadius: number, dotScale: number) {
    const [px, py] = this.project(worldX, worldZ);
    const ctx = this.ctx;
    ctx.font = `700 ${11 * dotScale}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3 * dotScale;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeText(text, px, py + dotRadius + 3 * dotScale);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, px, py + dotRadius + 3 * dotScale);
  }

  // The waypoint travel picker's own overlay (see update()'s travelFromWaypointId param) - a
  // link line from `from` to every other waypoint (travel is any-to-any, not a fixed route graph,
  // so this fans out from wherever the player actually is rather than drawing every possible pair),
  // a name label under every waypoint so an unlabeled dot isn't the only way to tell them apart,
  // and a distinct highlighted marker over `from` itself as a "you are here" cue.
  private drawWaypointTravelOverlay(from: WaypointDef, dotScale: number) {
    const ctx = this.ctx;
    const [fromX, fromY] = this.project(from.x, from.z);

    ctx.strokeStyle = COLOR_WAYPOINT_LINK;
    ctx.lineWidth = 1.5 * dotScale;
    ctx.setLineDash([5 * dotScale, 4 * dotScale]);
    for (const w of WAYPOINTS) {
      if (w.id === from.id) continue;
      const [wx, wy] = this.project(w.x, w.z);
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(wx, wy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const w of WAYPOINTS) this.waypointLabel(w.x, w.z, w.name, 3 * dotScale, dotScale);

    this.dot(from.x, from.z, COLOR_WAYPOINT_CURRENT, 4.5 * dotScale);
    ctx.beginPath();
    ctx.arc(fromX, fromY, 7 * dotScale, 0, Math.PI * 2);
    ctx.strokeStyle = COLOR_WAYPOINT_CURRENT;
    ctx.lineWidth = 1.5 * dotScale;
    ctx.stroke();
  }

  // Finds whichever WAYPOINTS entry projects closest to (canvasX, canvasY), within hitRadiusPx -
  // used by the travel picker's click handler (see main.ts). Reuses this.project() as it stood
  // after the most recent update() call, same as every other per-frame drawing call above does, so
  // this must only be called after update() has run for the frame/state being tested against.
  hitTestWaypoint(canvasX: number, canvasY: number, hitRadiusPx = 16): string | null {
    let closestId: string | null = null;
    let closestDistSq = hitRadiusPx * hitRadiusPx;
    for (const w of WAYPOINTS) {
      const [px, py] = this.project(w.x, w.z);
      const dx = px - canvasX;
      const dy = py - canvasY;
      const distSq = dx * dx + dy * dy;
      if (distSq <= closestDistSq) {
        closestDistSq = distSq;
        closestId = w.id;
      }
    }
    return closestId;
  }

  // showOverworldLandmarks is false inside a dungeon - NPCs/structures/portals/waypoints/boss arena
  // are all overworld-only content, per STRUCTURES/NPCS/DUNGEON_PORTALS/WAYPOINTS's own contracts.
  // No other players/enemies are drawn (a deliberate declutter choice - this map is for terrain/
  // landmark navigation, not live combat awareness), so update() only ever needs static content
  // plus the local player's own position/facing. travelFromWaypointId switches on the waypoint
  // travel picker's own overlay (see main.ts's renderWaypointPanel/hitTestWaypoint) - a highlighted
  // "you are here" marker plus a link line and an always-visible name label for every other
  // waypoint, instead of the plain unlabeled dots this draws normally. waypointsOnly keeps that
  // same picker to terrain + waypoints alone - still needs showOverworldLandmarks=true for the
  // right map sizing/terrain (this is overworld content, not "no landmarks" the way a dungeon is),
  // it just skips structures/NPCs/portal/boss arena/quest areas so they don't compete with the
  // travel network for attention on a panel whose only job is picking a waypoint.
  update(
    self: { x: number; z: number; rotationY: number },
    showOverworldLandmarks: boolean,
    questAreas: QuestAreaMarker[] = [],
    npcQuestStates: Map<string, QuestIndicatorState> = new Map(),
    travelFromWaypointId?: string,
    waypointsOnly = false,
  ) {
    const ctx = this.ctx;
    // Read live off the canvas element rather than a cached field, so resizing it (the big map's
    // drag handle) just takes effect on the next frame with no extra wiring.
    this.width = ctx.canvas.width;
    this.height = ctx.canvas.height;
    const half = Math.min(this.width, this.height) / 2;
    const dotScale = this.isBigMap ? 1.3 : 1; // slightly larger dots on the big map's bigger canvas

    this.viewCenter = this.isBigMap ? this.panCenter : self;
    this.viewRadius = this.isBigMap
      ? ((showOverworldLandmarks ? MAP_HALF_EXTENT : DUNGEON_HALF_EXTENT) * BIG_MAP_MARGIN) / this.zoomFactor
      : VIEW_RADIUS;
    // Uniform scale on both axes (not width/height computed independently) so a rectangular
    // canvas just reveals more world along its longer axis instead of stretching circles (the
    // boss arena, the small radar's own clip ring) into ellipses.
    this.scale = half / this.viewRadius;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    if (!this.isBigMap) {
      // The small radar is always a perfect circle (its panel is fixed-size and square) - clipped
      // to the smaller of the two dimensions just in case that ever changes.
      ctx.beginPath();
      ctx.arc(this.width / 2, this.height / 2, half, 0, Math.PI * 2);
      ctx.clip();
    }

    // Both branches are synchronous (computeHexTerrainGrid has no loading dependency, unlike the
    // old dungeon stone-texture fill this replaced), so there's no "not ready yet" case to fall
    // back for.
    {
      const grid = showOverworldLandmarks ? this.ensureHexGrid() : this.ensureDungeonHexGrid();
      if (this.isBigMap) {
        // See renderTerrainIfNeeded's own doc comment - the big map's pan/zoom only change on
        // deliberate input, so its (expensive, thousands-of-fills) terrain layer is cached and
        // just blitted here most frames instead of redrawn from scratch.
        ctx.drawImage(this.renderTerrainIfNeeded(grid), 0, 0);
      } else {
        // Dark backdrop first - covers any gap beyond the computed grid's own extent (e.g. the big
        // map's BIG_MAP_MARGIN padding around the true map edge).
        ctx.fillStyle = "rgba(16, 18, 26, 0.9)";
        ctx.fillRect(0, 0, this.width, this.height);
        this.drawHexTerrain(grid);
        // Darkened on top so the tiles read as a legible backdrop rather than competing with the
        // dots/self-arrow drawn over them - same tint the old texture fill used.
        ctx.fillStyle = "rgba(10, 10, 16, 0.35)";
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    if (showOverworldLandmarks && !waypointsOnly) {
      const [arenaX, arenaZ] = this.project(BOSS_ARENA_CENTER.x, BOSS_ARENA_CENTER.z);
      ctx.beginPath();
      ctx.arc(arenaX, arenaZ, BOSS_ARENA_RADIUS * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_BOSS_ARENA;
      ctx.fill();

      for (const marker of questAreas) {
        const [mx, my] = this.project(marker.x, marker.z);
        const radiusPx = marker.radius * this.scale;
        ctx.beginPath();
        ctx.arc(mx, my, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_QUEST_AREA;
        ctx.fill();
        ctx.strokeStyle = COLOR_QUEST_AREA_BORDER;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = COLOR_QUEST_AREA_BORDER;
        ctx.font = `700 ${12 * dotScale}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(marker.number), mx, my);
      }

      for (const s of STRUCTURES) this.dot(s.x, s.z, COLOR_STRUCTURE, 3 * dotScale);
      for (const n of Object.values(NPCS)) {
        const npcDotRadius = 2.5 * dotScale;
        this.dot(n.x, n.z, n.vendorItemIds ? COLOR_VENDOR_NPC : COLOR_NPC, npcDotRadius);
        const questState = npcQuestStates.get(n.id);
        if (questState) this.questIcon(n.x, n.z, questState, npcDotRadius, dotScale);
      }
      for (const p of DUNGEON_PORTALS) this.dot(p.x, p.z, COLOR_PORTAL, 3 * dotScale);
    }

    // Waypoints draw regardless of waypointsOnly (that flag only strips everything ELSE) - both
    // the normal minimap/big-map dots and the travel picker's own overlay live here.
    if (showOverworldLandmarks) {
      for (const w of WAYPOINTS) this.dot(w.x, w.z, COLOR_WAYPOINT, 3 * dotScale);
      const travelFrom = travelFromWaypointId ? WAYPOINTS.find((w) => w.id === travelFromWaypointId) : undefined;
      if (travelFrom) this.drawWaypointTravelOverlay(travelFrom, dotScale);
    }

    // Self, drawn last (always on top) as a small triangle pointing in the facing direction. On
    // the small radar this always lands exactly at the canvas center (viewCenter is self there);
    // on the big map self can be anywhere, so it's projected like any other point. rotationY is
    // atan2(moveX, moveZ) - it increases as facing turns from +z toward +x, which is
    // counterclockwise on screen (worldX->canvasX, worldZ->canvasY are both unflipped), so it has
    // to be negated here since canvas rotate() is clockwise-positive.
    const [selfX, selfY] = this.project(self.x, self.z);
    ctx.save();
    ctx.translate(selfX, selfY);
    ctx.rotate(-self.rotationY);
    ctx.beginPath();
    ctx.moveTo(0, 6 * dotScale);
    ctx.lineTo(4 * dotScale, -5 * dotScale);
    ctx.lineTo(-4 * dotScale, -5 * dotScale);
    ctx.closePath();
    ctx.fillStyle = COLOR_SELF;
    ctx.fill();
    ctx.restore();

    ctx.restore(); // undo clip (circular on the small radar; none on the big map)

    if (!this.isBigMap) {
      ctx.strokeStyle = COLOR_RING;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.width / 2, this.height / 2, half - 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
