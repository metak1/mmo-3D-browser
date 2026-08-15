import {
  ClassDef,
  ContentSnapshot,
  DungeonDef,
  DungeonEncounterSpec,
  EnemySpawnDef,
  EnemyStats,
  EnemyTypeDef,
  GameMapDef,
  ItemDef,
  loadGameContent,
  NpcDef,
  PlayerStats,
  QuestDef,
  SpellDef,
  StructureDef,
  TalentDef,
} from "@mmo/shared";
import { ClassRole } from "@mmo/shared";
import { prisma } from "./client.js";

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export async function getContentSnapshot(): Promise<ContentSnapshot> {
  const [
    classRows,
    spellRows,
    itemRows,
    talentRows,
    enemyTypeRows,
    npcRows,
    vendorRows,
    questRows,
    mapRows,
    spawnRows,
    dungeonRows,
    structureRows,
  ] = await Promise.all([
    prisma.gameClass.findMany(),
    prisma.spell.findMany(),
    prisma.item.findMany(),
    prisma.talent.findMany(),
    prisma.enemyType.findMany(),
    prisma.npc.findMany(),
    prisma.npcVendorItem.findMany(),
    prisma.quest.findMany(),
    prisma.gameMap.findMany(),
    prisma.enemySpawn.findMany(),
    prisma.dungeon.findMany(),
    prisma.structure.findMany(),
  ]);

  const vendorItemIdsByNpc = new Map<string, string[]>();
  for (const row of vendorRows) {
    const list = vendorItemIdsByNpc.get(row.npc_id);
    if (list) list.push(row.item_id);
    else vendorItemIdsByNpc.set(row.npc_id, [row.item_id]);
  }

  const classes: ClassDef[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    mainStat: c.main_stat as ClassDef["mainStat"],
    role: c.role as ClassRole,
  }));

  const spells: SpellDef[] = spellRows.map((s) => ({
    id: s.id,
    classId: s.class_id,
    name: s.name,
    description: s.description,
    effectType: s.effect_type as SpellDef["effectType"],
    targetType: s.target_type as SpellDef["targetType"],
    amount: nullToUndefined(s.amount),
    aoeRadius: nullToUndefined(s.aoe_radius),
    interruptsCast: s.interrupts_cast || undefined,
    cooldownMs: s.cooldown_ms,
    castTimeMs: s.cast_time_ms,
    range: s.range,
    projectileSpeed: nullToUndefined(s.projectile_speed),
  }));

  const items: ItemDef[] = itemRows.map((i) => ({
    id: i.id,
    name: i.name,
    slot: i.slot as ItemDef["slot"],
    bonuses: i.bonuses as Partial<PlayerStats>,
    icon: i.icon,
    description: i.description,
    basePrice: i.base_price,
  }));

  const talents: TalentDef[] = talentRows.map((t) => ({
    id: t.id,
    classId: t.class_id,
    name: t.name,
    description: t.description,
    maxRank: t.max_rank,
    effectKey: t.effect_key as TalentDef["effectKey"],
    perRank: t.per_rank,
  }));

  const enemyTypes: EnemyTypeDef[] = enemyTypeRows.map((e) => ({
    id: e.id,
    name: e.name,
    behavior: e.behavior as EnemyTypeDef["behavior"],
    xpReward: e.xp_reward,
    goldReward: e.gold_reward,
    stats: e.stats as unknown as EnemyStats,
  }));

  const npcs: NpcDef[] = npcRows.map((n) => ({
    id: n.id,
    name: n.name,
    x: n.x,
    z: n.z,
    mapId: n.map_id,
    vendorItemIds: vendorItemIdsByNpc.get(n.id),
  }));

  const quests: QuestDef[] = questRows.map((q) => ({
    id: q.id,
    name: q.name,
    description: q.description,
    giverNpcId: q.giver_npc_id,
    objectiveEnemyTypeId: q.objective_enemy_type_id,
    objectiveCount: q.objective_count,
    rewardXp: q.reward_xp,
    rewardItemId: nullToUndefined(q.reward_item_id),
  }));

  const maps: GameMapDef[] = mapRows.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind as GameMapDef["kind"],
    halfExtent: m.half_extent,
    isActive: m.is_active,
    portalX: nullToUndefined(m.portal_x),
    portalZ: nullToUndefined(m.portal_z),
    bossArenaX: nullToUndefined(m.boss_arena_x),
    bossArenaZ: nullToUndefined(m.boss_arena_z),
    bossArenaRadius: nullToUndefined(m.boss_arena_radius),
  }));

  const spawns: EnemySpawnDef[] = spawnRows.map((s) => ({
    id: s.id,
    enemyTypeId: s.enemy_type_id,
    mapId: s.map_id,
    x: s.x,
    z: s.z,
    respawnMs: nullToUndefined(s.respawn_ms),
  }));

  const dungeons: DungeonDef[] = dungeonRows.map((d) => ({
    id: d.id,
    name: d.name,
    mapId: d.map_id,
    isActive: d.is_active,
    partySize: d.party_size,
    composition: d.composition as Record<ClassRole, number>,
    encounters: d.encounters as unknown as DungeonEncounterSpec[][],
  }));

  const structures: StructureDef[] = structureRows.map((s) => ({
    id: s.id,
    name: s.name,
    mapId: s.map_id,
    kind: s.kind as StructureDef["kind"],
    x: s.x,
    z: s.z,
    rotationY: s.rotation_y,
    width: s.width,
    depth: s.depth,
    height: s.height,
    color: s.color,
  }));

  return { classes, spells, items, talents, enemyTypes, npcs, quests, maps, dungeons, spawns, structures };
}

// The single function both server boot and every admin CRUD mutation call - see
// loadGameContent's contract in shared/src/types.ts for why the snapshot is built in one
// pass here (all queries in parallel) before being handed off synchronously.
export async function reloadGameContent(): Promise<void> {
  const snapshot = await getContentSnapshot();
  loadGameContent(snapshot);
}
