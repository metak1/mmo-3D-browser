import { BOSS_ARENA_CENTER, BOSS_ARENA_RADIUS, NPCS, PORTAL_POSITION, STRUCTURES } from "@mmo/shared";

// World-unit radius shown from the player (center) to the edge of the circle - independent of
// MAP_HALF_EXTENT, since a player-centered view (not a full static map) is what stays readable
// once the overworld is hundreds of units across. WoW-style: north-up, not rotated with the
// camera, since the camera itself never orbits (see Scene.ts's CAMERA_PITCH comment).
const VIEW_RADIUS = 70;

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
  private readonly size: number;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.size = canvas.width;
  }

  private project(worldX: number, worldZ: number, selfX: number, selfZ: number): [number, number] {
    const scale = this.size / 2 / VIEW_RADIUS;
    return [this.size / 2 + (worldX - selfX) * scale, this.size / 2 + (worldZ - selfZ) * scale];
  }

  private dot(worldX: number, worldZ: number, selfX: number, selfZ: number, color: string, radius: number) {
    const [px, py] = this.project(worldX, worldZ, selfX, selfZ);
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
    const half = this.size / 2;

    ctx.clearRect(0, 0, this.size, this.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "rgba(20, 22, 32, 0.85)";
    ctx.fillRect(0, 0, this.size, this.size);

    if (showOverworldLandmarks) {
      const [arenaX, arenaZ] = this.project(BOSS_ARENA_CENTER.x, BOSS_ARENA_CENTER.z, self.x, self.z);
      ctx.beginPath();
      ctx.arc(arenaX, arenaZ, BOSS_ARENA_RADIUS * (half / VIEW_RADIUS), 0, Math.PI * 2);
      ctx.fillStyle = COLOR_BOSS_ARENA;
      ctx.fill();

      for (const s of STRUCTURES) this.dot(s.x, s.z, self.x, self.z, COLOR_STRUCTURE, 3);
      for (const n of Object.values(NPCS)) {
        this.dot(n.x, n.z, self.x, self.z, n.vendorItemIds ? COLOR_VENDOR_NPC : COLOR_NPC, 2.5);
      }
      this.dot(PORTAL_POSITION.x, PORTAL_POSITION.z, self.x, self.z, COLOR_PORTAL, 3);
    }

    for (const enemy of enemies) {
      this.dot(enemy.x, enemy.z, self.x, self.z, enemy.isBoss ? COLOR_BOSS : COLOR_ENEMY, enemy.isBoss ? 4 : 2.5);
    }
    for (const other of others) this.dot(other.x, other.z, self.x, self.z, COLOR_PLAYER, 3);

    // Self, drawn last (always on top) as a small triangle pointing in the facing direction.
    // rotationY is atan2(moveX, moveZ) - it increases as facing turns from +z toward +x, which
    // is counterclockwise on screen (worldX->canvasX, worldZ->canvasY are both unflipped), so it
    // has to be negated here since canvas rotate() is clockwise-positive.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-self.rotationY);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(4, -5);
    ctx.lineTo(-4, -5);
    ctx.closePath();
    ctx.fillStyle = COLOR_SELF;
    ctx.fill();
    ctx.restore();

    ctx.restore(); // undo circular clip

    ctx.strokeStyle = COLOR_RING;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
