import {
  ClassDef,
  ContentSnapshot,
  DungeonDef,
  DungeonSpawnDef,
  EffectDef,
  EnemySpawnDef,
  EnemySpawnZoneDef,
  EnemyStats,
  EnemyTypeDef,
  GameMapDef,
  GatheringNodeDef,
  GatheringNodeTypeDef,
  ItemDef,
  loadGameContent,
  NpcDef,
  PlayerStats,
  QuestDef,
  RecipeDef,
  RespawnPointDef,
  SpellDef,
  StructureDef,
  TalentDef,
  WaypointDef,
  FurnitureDef,
  HexTileOverrideDef,
  HexTerrainKind,
} from "@mmo/shared";
import { ClassRole } from "@mmo/shared";
import { pool } from "./client.js";

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

interface GameClassRow {
  id: string;
  name: string;
  main_stat: string;
  role: string;
}

interface SpellRow {
  id: string;
  class_id: string;
  name: string;
  description: string;
  target_type: string;
  cooldown_ms: number;
  cast_time_ms: number;
  range: number;
  projectile_speed: number | null;
  effects: EffectDef[];
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  slot: string | null;
  bonuses: unknown;
  icon: string;
  description: string;
  base_price: number;
  use_effects: EffectDef[] | null;
}

interface RecipeRow {
  id: string;
  profession: string;
  name: string;
  required_level: number;
  ingredients: unknown;
  output_item_id: string;
  output_quantity: number;
  xp_award: number;
}

interface GatheringNodeTypeRow {
  id: string;
  profession: string;
  name: string;
  model_id: string;
  output_item_id: string;
  output_quantity: number;
  xp_award: number;
  respawn_ms: number;
  required_level: number;
}

interface GatheringNodeRow {
  id: string;
  map_id: string;
  node_type_id: string;
  x: number;
  z: number;
}

interface TalentRow {
  id: string;
  class_id: string;
  name: string;
  description: string;
  max_rank: number;
  effect: unknown;
  tier: number;
  column_index: number;
  prerequisite_talent_id: string | null;
}

interface EnemyTypeRow {
  id: string;
  name: string;
  behavior: string;
  xp_reward: number;
  gold_reward: number;
  stats: unknown;
  model_id: string | null;
}

interface NpcRow {
  id: string;
  name: string;
  x: number;
  z: number;
  map_id: string;
  y_offset: number;
  teaches_profession_id: string | null;
}

interface NpcVendorItemRow {
  npc_id: string;
  item_id: string;
}

interface QuestRow {
  id: string;
  name: string;
  description: string;
  giver_npc_id: string;
  objective_enemy_type_id: string;
  objective_count: number;
  reward_xp: number;
  reward_item_id: string | null;
  reward_grants_mount: boolean;
}

interface GameMapRow {
  id: string;
  name: string;
  kind: string;
  half_extent: number;
  is_active: boolean;
  portal_x: number | null;
  portal_z: number | null;
  spawn_x: number | null;
  spawn_z: number | null;
  boss_arena_x: number | null;
  boss_arena_z: number | null;
  boss_arena_radius: number | null;
}

interface EnemySpawnRow {
  id: string;
  map_id: string;
  enemy_type_id: string;
  x: number;
  z: number;
  respawn_ms: number | null;
}

interface EnemySpawnZoneRow {
  id: string;
  map_id: string;
  x: number;
  z: number;
  radius: number;
  max_population: number;
  respawn_ms: number | null;
  wander_radius: number | null;
  leash_range: number | null;
}

interface EnemySpawnZoneTypeRow {
  zone_id: string;
  enemy_type_id: string;
}

interface DungeonRow {
  id: string;
  name: string;
  map_id: string;
  is_active: boolean;
  party_size: number;
  composition: unknown;
  spawns: unknown;
}

interface StructureRow {
  id: string;
  name: string;
  map_id: string;
  kind: string;
  x: number;
  z: number;
  rotation_y: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  y_offset: number;
  model_id: string | null;
  light_intensity: number | null;
}

interface WaypointRow {
  id: string;
  name: string;
  map_id: string;
  x: number;
  z: number;
}

interface RespawnPointRow {
  id: string;
  name: string;
  map_id: string;
  x: number;
  z: number;
}

interface FurnitureRow {
  id: string;
  name: string;
  map_id: string;
  kind: string;
  x: number;
  z: number;
  rotation_y: number;
  color: string;
  y_offset: number;
}

interface HexTileRow {
  id: string;
  map_id: string;
  q: number;
  r: number;
  kind: string;
  rotation: number | null;
  elevation: number | null;
  ramp_rotation: number | null;
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
    spawnZoneRows,
    spawnZoneTypeRows,
    dungeonRows,
    structureRows,
    waypointRows,
    respawnPointRows,
    furnitureRows,
    hexTileRows,
    recipeRows,
    gatheringNodeTypeRows,
    gatheringNodeRows,
  ] = await Promise.all([
    pool.query<GameClassRow>("SELECT * FROM game_classes").then((r) => r.rows),
    pool.query<SpellRow>("SELECT * FROM spells").then((r) => r.rows),
    pool.query<ItemRow>("SELECT * FROM items").then((r) => r.rows),
    pool.query<TalentRow>("SELECT * FROM talents").then((r) => r.rows),
    pool.query<EnemyTypeRow>("SELECT * FROM enemy_types").then((r) => r.rows),
    pool.query<NpcRow>("SELECT * FROM npcs").then((r) => r.rows),
    pool.query<NpcVendorItemRow>("SELECT * FROM npc_vendor_items").then((r) => r.rows),
    pool.query<QuestRow>("SELECT * FROM quests").then((r) => r.rows),
    pool.query<GameMapRow>("SELECT * FROM game_maps").then((r) => r.rows),
    pool.query<EnemySpawnRow>("SELECT * FROM enemy_spawns").then((r) => r.rows),
    pool.query<EnemySpawnZoneRow>("SELECT * FROM enemy_spawn_zones").then((r) => r.rows),
    pool.query<EnemySpawnZoneTypeRow>("SELECT * FROM enemy_spawn_zone_types").then((r) => r.rows),
    pool.query<DungeonRow>("SELECT * FROM dungeons").then((r) => r.rows),
    pool.query<StructureRow>("SELECT * FROM structures").then((r) => r.rows),
    pool.query<WaypointRow>("SELECT * FROM waypoints").then((r) => r.rows),
    pool.query<RespawnPointRow>("SELECT * FROM respawn_points").then((r) => r.rows),
    pool.query<FurnitureRow>("SELECT * FROM furniture").then((r) => r.rows),
    pool.query<HexTileRow>("SELECT * FROM hex_tiles").then((r) => r.rows),
    pool.query<RecipeRow>("SELECT * FROM recipes").then((r) => r.rows),
    pool.query<GatheringNodeTypeRow>("SELECT * FROM gathering_node_types").then((r) => r.rows),
    pool.query<GatheringNodeRow>("SELECT * FROM gathering_nodes").then((r) => r.rows),
  ]);

  const vendorItemIdsByNpc = new Map<string, string[]>();
  for (const row of vendorRows) {
    const list = vendorItemIdsByNpc.get(row.npc_id);
    if (list) list.push(row.item_id);
    else vendorItemIdsByNpc.set(row.npc_id, [row.item_id]);
  }

  const enemyTypeIdsByZone = new Map<string, string[]>();
  for (const row of spawnZoneTypeRows) {
    const list = enemyTypeIdsByZone.get(row.zone_id);
    if (list) list.push(row.enemy_type_id);
    else enemyTypeIdsByZone.set(row.zone_id, [row.enemy_type_id]);
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
    targetType: s.target_type as SpellDef["targetType"],
    cooldownMs: s.cooldown_ms,
    castTimeMs: s.cast_time_ms,
    range: s.range,
    projectileSpeed: nullToUndefined(s.projectile_speed),
    effects: s.effects,
  }));

  const items: ItemDef[] = itemRows.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category as ItemDef["category"],
    slot: nullToUndefined(i.slot) as ItemDef["slot"],
    bonuses: i.bonuses as Partial<PlayerStats>,
    icon: i.icon,
    description: i.description,
    basePrice: i.base_price,
    useEffects: nullToUndefined(i.use_effects),
  }));

  const talents: TalentDef[] = talentRows.map((t) => ({
    id: t.id,
    classId: t.class_id,
    name: t.name,
    description: t.description,
    maxRank: t.max_rank,
    effect: t.effect as TalentDef["effect"],
    tier: t.tier,
    column: t.column_index,
    prerequisiteTalentId: t.prerequisite_talent_id ?? undefined,
  }));

  const enemyTypes: EnemyTypeDef[] = enemyTypeRows.map((e) => ({
    id: e.id,
    name: e.name,
    behavior: e.behavior as EnemyTypeDef["behavior"],
    xpReward: e.xp_reward,
    goldReward: e.gold_reward,
    stats: e.stats as unknown as EnemyStats,
    modelId: nullToUndefined(e.model_id),
  }));

  const npcs: NpcDef[] = npcRows.map((n) => ({
    id: n.id,
    name: n.name,
    x: n.x,
    z: n.z,
    yOffset: n.y_offset,
    mapId: n.map_id,
    vendorItemIds: vendorItemIdsByNpc.get(n.id),
    teachesProfessionId: nullToUndefined(n.teaches_profession_id) as NpcDef["teachesProfessionId"],
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
    rewardGrantsMount: q.reward_grants_mount,
  }));

  const maps: GameMapDef[] = mapRows.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind as GameMapDef["kind"],
    halfExtent: m.half_extent,
    isActive: m.is_active,
    portalX: nullToUndefined(m.portal_x),
    portalZ: nullToUndefined(m.portal_z),
    spawnX: nullToUndefined(m.spawn_x),
    spawnZ: nullToUndefined(m.spawn_z),
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

  const spawnZones: EnemySpawnZoneDef[] = spawnZoneRows.map((z) => ({
    id: z.id,
    mapId: z.map_id,
    x: z.x,
    z: z.z,
    radius: z.radius,
    enemyTypeIds: enemyTypeIdsByZone.get(z.id) ?? [],
    maxPopulation: z.max_population,
    respawnMs: nullToUndefined(z.respawn_ms),
    wanderRadius: nullToUndefined(z.wander_radius),
    leashRange: nullToUndefined(z.leash_range),
  }));

  const dungeons: DungeonDef[] = dungeonRows.map((d) => ({
    id: d.id,
    name: d.name,
    mapId: d.map_id,
    isActive: d.is_active,
    partySize: d.party_size,
    composition: d.composition as Record<ClassRole, number>,
    spawns: d.spawns as unknown as DungeonSpawnDef[],
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
    yOffset: s.y_offset,
    modelId: nullToUndefined(s.model_id),
    lightIntensity: nullToUndefined(s.light_intensity),
  }));

  const waypoints: WaypointDef[] = waypointRows.map((w) => ({
    id: w.id,
    name: w.name,
    mapId: w.map_id,
    x: w.x,
    z: w.z,
  }));

  const respawnPoints: RespawnPointDef[] = respawnPointRows.map((r) => ({
    id: r.id,
    name: r.name,
    mapId: r.map_id,
    x: r.x,
    z: r.z,
  }));

  const furniture: FurnitureDef[] = furnitureRows.map((f) => ({
    id: f.id,
    name: f.name,
    mapId: f.map_id,
    kind: f.kind as FurnitureDef["kind"],
    x: f.x,
    z: f.z,
    rotationY: f.rotation_y,
    color: f.color,
    yOffset: f.y_offset,
  }));

  const hexTiles: HexTileOverrideDef[] = hexTileRows.map((h) => ({
    id: h.id,
    mapId: h.map_id,
    q: h.q,
    r: h.r,
    kind: h.kind as HexTerrainKind,
    rotation: nullToUndefined(h.rotation),
    elevation: nullToUndefined(h.elevation),
    rampRotation: nullToUndefined(h.ramp_rotation),
  }));

  const recipes: RecipeDef[] = recipeRows.map((r) => ({
    id: r.id,
    profession: r.profession as RecipeDef["profession"],
    name: r.name,
    requiredLevel: r.required_level,
    ingredients: r.ingredients as RecipeDef["ingredients"],
    outputItemId: r.output_item_id,
    outputQuantity: r.output_quantity,
    xpAward: r.xp_award,
  }));

  const gatheringNodeTypes: GatheringNodeTypeDef[] = gatheringNodeTypeRows.map((t) => ({
    id: t.id,
    profession: t.profession as GatheringNodeTypeDef["profession"],
    name: t.name,
    modelId: t.model_id,
    outputItemId: t.output_item_id,
    outputQuantity: t.output_quantity,
    xpAward: t.xp_award,
    respawnMs: t.respawn_ms,
    requiredLevel: t.required_level,
  }));

  const gatheringNodes: GatheringNodeDef[] = gatheringNodeRows.map((n) => ({
    id: n.id,
    mapId: n.map_id,
    nodeTypeId: n.node_type_id,
    x: n.x,
    z: n.z,
  }));

  return {
    classes,
    spells,
    items,
    talents,
    enemyTypes,
    npcs,
    quests,
    maps,
    dungeons,
    spawns,
    spawnZones,
    structures,
    waypoints,
    respawnPoints,
    furniture,
    hexTiles,
    recipes,
    gatheringNodeTypes,
    gatheringNodes,
  };
}

// The single function both server boot and every admin CRUD mutation call - see
// loadGameContent's contract in shared/src/types.ts for why the snapshot is built in one
// pass here (all queries in parallel) before being handed off synchronously.
export async function reloadGameContent(): Promise<void> {
  const snapshot = await getContentSnapshot();
  loadGameContent(snapshot);
}
