import { BOSS_ARENA_CENTER, BOSS_ARENA_RADIUS, DUNGEON_HALF_EXTENT, MAP_HALF_EXTENT, NPCS, PORTAL_POSITION, STRUCTURES } from "@mmo/shared";

// World-unit radius shown from the player (center) to the edge of the small radar - independent
// of MAP_HALF_EXTENT, since a player-centered view (not a full static map) is what stays readable
// once the overworld is hundreds of units across. WoW-style: north-up, not rotated with the
// camera, since the camera itself never orbits (see Scene.ts's CAMERA_PITCH comment). The big map
// (see isBigMap below) uses the actual map half-extent instead, so it shows everything at once.
const VIEW_RADIUS = 70;
const BIG_MAP_MARGIN = 1.05; // small margin so landmarks right at the map edge aren't clipped

// Same repeat-every-4-world-units convention as the 3D ground itself (see textures.ts's
// groundTexture), so the minimap's tiling density matches what the ground actually looks like.
const TILE_WORLD_SIZE = 4;

interface TilePattern {
  pattern: CanvasPattern;
  imageSize: number; // native pixel size of the source image, so the tile can be rescaled to TILE_WORLD_SIZE
}

const COLOR_SELF = "#ffffff";
const COLOR_PLAYER = "#4ac0e8";
const COLOR_NPC = "#f5d76e";
const COLOR_VENDOR_NPC = "#4fd166";
const COLOR_ENEMY = "#e05a4e";
const COLOR_BOSS = "#ff2d55";
const COLOR_STRUCTURE = "#8a95b8";
const COLOR_PORTAL = "#b06fe0";
const COLOR_BOSS_ARENA = "rgba(224, 90, 78, 0.25)";
const COLOR_RING = "#4a5578";

export interface MinimapEntity {
  x: number;
  z: number;
}

export interface MinimapEnemy extends MinimapEntity {
  isBoss: boolean;
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  // Same source images as the 3D ground (client/src/game/textures.ts) - grass for the overworld,
  // stone for dungeons. Null until each image finishes loading; update() falls back to the old
  // flat fill until then, so there's never a broken/blank frame.
  private groundTile: TilePattern | null = null;
  private stoneTile: TilePattern | null = null;
  // Set fresh at the top of every update() call - project()/dot()/fillWithTile() all read these
  // instead of threading center/radius/canvas-size through every call site. Canvas width/height
  // are read live off the element rather than cached, so a resizable canvas (see the big map's
  // resize handle, wired in main.ts via ResizeObserver) just works without any extra plumbing.
  private viewCenter = { x: 0, z: 0 };
  private viewRadius = VIEW_RADIUS;
  private width = 0;
  private height = 0;
  private scale = 1; // canvas pixels per world unit - uniform on both axes, see update()

  constructor(
    canvas: HTMLCanvasElement,
    // The "press M" full map: fixed on the world/map center instead of following the player, at
    // a radius wide enough to show the whole map at once, and not clipped to a circle - the small
    // radar and the big map are otherwise identical, just two instances over different canvases.
    private readonly isBigMap = false,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.loadTile("/textures/ground.jpg", (tile) => (this.groundTile = tile));
    this.loadTile("/textures/stone.jpg", (tile) => (this.stoneTile = tile));
  }

  private loadTile(src: string, onReady: (tile: TilePattern) => void) {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const pattern = this.ctx.createPattern(img, "repeat");
      if (pattern) onReady({ pattern, imageSize: img.naturalWidth });
    };
  }

  private project(worldX: number, worldZ: number): [number, number] {
    return [this.width / 2 + (worldX - this.viewCenter.x) * this.scale, this.height / 2 + (worldZ - this.viewCenter.z) * this.scale];
  }

  // Positions the tile pattern so it scrolls with the world exactly like every dot does (same
  // worldX - viewCenter.x convention as project()), instead of the texture sitting fixed to the
  // canvas while everything else moves across it.
  private fillWithTile(tile: TilePattern) {
    const tilePx = TILE_WORLD_SIZE * this.scale;
    const matrix = new DOMMatrix()
      .translate(this.width / 2 - ((this.viewCenter.x * this.scale) % tilePx), this.height / 2 - ((this.viewCenter.z * this.scale) % tilePx))
      .scale(tilePx / tile.imageSize);
    tile.pattern.setTransform(matrix);
    this.ctx.fillStyle = tile.pattern;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private dot(worldX: number, worldZ: number, color: string, radius: number) {
    const [px, py] = this.project(worldX, worldZ);
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  // showOverworldLandmarks is false inside a dungeon - NPCs/structures/portal/boss arena are
  // all overworld-only content, per STRUCTURES/NPCS/PORTAL_POSITION's own contracts.
  update(
    self: { x: number; z: number; rotationY: number },
    others: MinimapEntity[],
    enemies: MinimapEnemy[],
    showOverworldLandmarks: boolean,
  ) {
    const ctx = this.ctx;
    // Read live off the canvas element rather than a cached field, so resizing it (the big map's
    // drag handle) just takes effect on the next frame with no extra wiring.
    this.width = ctx.canvas.width;
    this.height = ctx.canvas.height;
    const half = Math.min(this.width, this.height) / 2;
    const dotScale = this.isBigMap ? 1.3 : 1; // slightly larger dots on the big map's bigger canvas

    this.viewCenter = this.isBigMap ? { x: 0, z: 0 } : self;
    this.viewRadius = this.isBigMap ? (showOverworldLandmarks ? MAP_HALF_EXTENT : DUNGEON_HALF_EXTENT) * BIG_MAP_MARGIN : VIEW_RADIUS;
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

    const tile = showOverworldLandmarks ? this.groundTile : this.stoneTile;
    if (tile) {
      this.fillWithTile(tile);
      // Darkened on top so the texture reads as a subtle backdrop rather than competing with
      // the dots/self-arrow drawn over it - same tint the old flat fill used.
      ctx.fillStyle = "rgba(10, 10, 16, 0.55)";
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = "rgba(20, 22, 32, 0.85)"; // fallback until the texture image has loaded
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (showOverworldLandmarks) {
      const [arenaX, arenaZ] = this.project(BOSS_ARENA_CENTER.x, BOSS_ARENA_CENTER.z);
      ctx.beginPath();
      ctx.arc(arenaX, arenaZ, BOSS_ARENA_RADIUS * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_BOSS_ARENA;
      ctx.fill();

      for (const s of STRUCTURES) this.dot(s.x, s.z, COLOR_STRUCTURE, 3 * dotScale);
      for (const n of Object.values(NPCS)) {
        this.dot(n.x, n.z, n.vendorItemIds ? COLOR_VENDOR_NPC : COLOR_NPC, 2.5 * dotScale);
      }
      this.dot(PORTAL_POSITION.x, PORTAL_POSITION.z, COLOR_PORTAL, 3 * dotScale);
    }

    for (const enemy of enemies) {
      this.dot(enemy.x, enemy.z, enemy.isBoss ? COLOR_BOSS : COLOR_ENEMY, (enemy.isBoss ? 4 : 2.5) * dotScale);
    }
    for (const other of others) this.dot(other.x, other.z, COLOR_PLAYER, 3 * dotScale);

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
