// Idempotent (every row is an upsert keyed by its content id) - inserts the exact content that
// used to be hardcoded in shared/src/types.ts, so the game's live behavior is unchanged
// immediately after migrating. See the "Admin Content Backend" plan. Safe to re-run.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- Classes ---
  const classes = [
    { id: "warrior", name: "Warrior", main_stat: "strength", role: "tank" },
    { id: "rogue", name: "Rogue", main_stat: "dexterity", role: "dps" },
    { id: "ranger", name: "Ranger", main_stat: "dexterity", role: "dps" },
    { id: "oracle", name: "Oracle", main_stat: "intellect", role: "healer" },
    { id: "mage", name: "Mage", main_stat: "intellect", role: "dps" },
  ];
  for (const c of classes) {
    await prisma.gameClass.upsert({ where: { id: c.id }, create: c, update: c });
  }

  // --- Spells ---
  const spells = [
    // Warrior
    {
      id: "warrior_slash",
      class_id: "warrior",
      name: "Slash",
      description: "A quick, brutal cut.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 14,
      cooldown_ms: 1200,
      range: 2.5,
      cast_time_ms: 0,
    },
    {
      id: "warrior_shield_bash",
      class_id: "warrior",
      name: "Shield Bash",
      description: "Slams a foe with your shield, breaking their concentration.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 6,
      interrupts_cast: true,
      cooldown_ms: 6000,
      range: 2.5,
      cast_time_ms: 0,
    },
    {
      id: "warrior_whirlwind",
      class_id: "warrior",
      name: "Whirlwind",
      description: "Spin and strike every enemy in reach.",
      effect_type: "damage",
      target_type: "self",
      amount: 10,
      aoe_radius: 4,
      cooldown_ms: 4000,
      range: 4,
      cast_time_ms: 0,
    },
    // Rogue
    {
      id: "rogue_backstab",
      class_id: "rogue",
      name: "Backstab",
      description: "A blade in exactly the wrong place.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 16,
      cooldown_ms: 1200,
      range: 2.5,
      cast_time_ms: 0,
    },
    {
      id: "rogue_garrote",
      class_id: "rogue",
      name: "Garrote",
      description: "Chokes off a foe's breath, and their spell.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 6,
      interrupts_cast: true,
      cooldown_ms: 6000,
      range: 2.5,
      cast_time_ms: 0,
    },
    {
      id: "rogue_fan_of_knives",
      class_id: "rogue",
      name: "Fan of Knives",
      description: "A spray of blades around your target.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 10,
      aoe_radius: 4,
      cooldown_ms: 4000,
      range: 2.5,
      cast_time_ms: 0,
    },
    // Ranger
    {
      id: "ranger_aimed_shot",
      class_id: "ranger",
      name: "Aimed Shot",
      description: "A carefully placed arrow.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 18,
      cooldown_ms: 1500,
      range: 9,
      cast_time_ms: 400,
      projectile_speed: 12,
    },
    {
      id: "ranger_disabling_shot",
      class_id: "ranger",
      name: "Disabling Shot",
      description: "Pins a caster's hands before they finish the gesture.",
      effect_type: "interrupt",
      target_type: "enemy",
      cooldown_ms: 6000,
      range: 9,
      cast_time_ms: 0,
    },
    {
      id: "ranger_explosive_trap",
      class_id: "ranger",
      name: "Explosive Trap",
      description: "Rigs a patch of ground to blow.",
      effect_type: "damage",
      target_type: "ground",
      amount: 16,
      aoe_radius: 3,
      cooldown_ms: 5000,
      range: 8,
      cast_time_ms: 500,
    },
    // Oracle
    {
      id: "oracle_smite",
      class_id: "oracle",
      name: "Smite",
      description: "A bolt of judgment.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 14,
      cooldown_ms: 1500,
      range: 9,
      cast_time_ms: 300,
      projectile_speed: 10,
    },
    {
      id: "oracle_renew",
      class_id: "oracle",
      name: "Renew",
      description: "Knits flesh and spirit back together. Heals yourself if no ally is targeted.",
      effect_type: "heal",
      target_type: "ally",
      amount: 20,
      cooldown_ms: 3000,
      range: 8,
      cast_time_ms: 800,
    },
    {
      id: "oracle_cleanse",
      class_id: "oracle",
      name: "Cleanse",
      description: "Washes away ailments afflicting an ally (or yourself).",
      effect_type: "dispel",
      target_type: "ally",
      cooldown_ms: 8000,
      range: 8,
      cast_time_ms: 0,
    },
    // Mage
    {
      id: "mage_frostbolt",
      class_id: "mage",
      name: "Frostbolt",
      description: "A shard of ice, slow to arrive and hard to forgive.",
      effect_type: "damage",
      target_type: "enemy",
      amount: 22,
      cooldown_ms: 2000,
      range: 9,
      cast_time_ms: 1000,
      projectile_speed: 9,
    },
    {
      id: "mage_blizzard",
      class_id: "mage",
      name: "Blizzard",
      description: "Calls down a storm over a patch of ground.",
      effect_type: "damage",
      target_type: "ground",
      amount: 18,
      aoe_radius: 3.5,
      cooldown_ms: 6000,
      range: 9,
      cast_time_ms: 1200,
    },
    {
      id: "mage_counterspell",
      class_id: "mage",
      name: "Counterspell",
      description: "Unravels a spell before it finishes forming.",
      effect_type: "interrupt",
      target_type: "enemy",
      cooldown_ms: 8000,
      range: 9,
      cast_time_ms: 0,
    },
  ];
  for (const s of spells) {
    await prisma.spell.upsert({ where: { id: s.id }, create: s, update: s });
  }

  // --- Items ---
  const items = [
    {
      id: "rusty_sword",
      name: "Rusty Sword",
      slot: "weapon",
      bonuses: { mainStat: 3 },
      icon: "🗡️",
      description: "Pitted and dull, but it still holds an edge.",
      base_price: 40,
    },
    {
      id: "hunting_bow",
      name: "Hunting Bow",
      slot: "weapon",
      bonuses: { mainStat: 3 },
      icon: "🏹",
      description: "Favored by scouts for its light draw weight.",
      base_price: 40,
    },
    {
      id: "apprentice_wand",
      name: "Apprentice Wand",
      slot: "weapon",
      bonuses: { mainStat: 3 },
      icon: "🪄",
      description: "A first wand, worn smooth by nervous hands.",
      base_price: 40,
    },
    {
      id: "leather_vest",
      name: "Leather Vest",
      slot: "armor",
      bonuses: { vitality: 2, armor: 2 },
      icon: "🦺",
      description: "Boiled leather, stiff enough to turn a blade.",
      base_price: 35,
    },
    {
      id: "chainmail_hauberk",
      name: "Chainmail Hauberk",
      slot: "armor",
      bonuses: { armor: 5 },
      icon: "🥋",
      description: "Interlocked rings, heavy but dependable.",
      base_price: 45,
    },
    {
      id: "padded_robe",
      name: "Padded Robe",
      slot: "armor",
      bonuses: { vitality: 3, mainStat: 1 },
      icon: "👘",
      description: "Woven with faint warding sigils along the hem.",
      base_price: 40,
    },
    {
      id: "lucky_charm",
      name: "Lucky Charm",
      slot: "trinket",
      bonuses: { luck: 4 },
      icon: "🍀",
      description: "Rumored to have never left its owner's pocket.",
      base_price: 45,
    },
    {
      id: "signet_ring",
      name: "Signet Ring",
      slot: "trinket",
      bonuses: { mainStat: 4 },
      icon: "💍",
      description: "A minor house crest, edges worn smooth.",
      base_price: 50,
    },
    {
      id: "amulet_of_vigor",
      name: "Amulet of Vigor",
      slot: "trinket",
      bonuses: { vitality: 3 },
      icon: "📿",
      description: "Warm to the touch, even in the cold.",
      base_price: 35,
    },
    {
      id: "warden_relic",
      name: "Warden's Relic",
      slot: "trinket",
      bonuses: { mainStat: 6, vitality: 4 },
      icon: "🔱",
      description: "Torn from the Warden's shattered core, still humming with old power.",
      base_price: 120,
    },
  ];
  for (const i of items) {
    await prisma.item.upsert({ where: { id: i.id }, create: i, update: i });
  }

  // --- Talents (5 per class: 3 flat statBonus at maxRank 12, plus one extraCharges and one
  // onCastBuff talent at maxRank 1 - those two kinds are on/off, not stackable like the flat
  // bonuses, so a lower max makes more sense than uniformly applying TALENT_MAX_RANK everywhere
  // like the old flat-only model did). See shared/src/types.ts's TalentEffect for the shape.
  const TALENT_MAX_RANK = 12;
  type TalentEffectSeed =
    | { kind: "statBonus"; stat: string; perRank: number }
    | { kind: "extraCharges"; spellId: string; perRank: number }
    | { kind: "onCastBuff"; spellId: string; buffId: string };
  const statBonus = (stat: string, perRank: number): TalentEffectSeed => ({ kind: "statBonus", stat, perRank });
  const extraCharges = (spellId: string, perRank = 1): TalentEffectSeed => ({ kind: "extraCharges", spellId, perRank });
  const onCastBuff = (spellId: string, buffId: string): TalentEffectSeed => ({ kind: "onCastBuff", spellId, buffId });

  const talentDefs: Array<[string, string, string, string, number, TalentEffectSeed]> = [
    [
      "warrior",
      "iron_skin",
      "Iron Skin",
      "Years of taking hits taught your body to shrug them off.",
      TALENT_MAX_RANK,
      statBonus("armorBonus", 1),
    ],
    [
      "warrior",
      "crushing_blows",
      "Crushing Blows",
      "Every swing carries a little more weight.",
      TALENT_MAX_RANK,
      statBonus("damagePercent", 1.5),
    ],
    [
      "warrior",
      "stalwart_heart",
      "Stalwart Heart",
      "Your resolve keeps you standing after lesser warriors would fall.",
      TALENT_MAX_RANK,
      statBonus("maxHpPercent", 1.25),
    ],
    [
      "warrior",
      "battle_fury",
      "Battle Fury",
      "A well-placed Shield Bash leaves you charged with momentum.",
      1,
      onCastBuff("warrior_shield_bash", "battleFury"),
    ],
    [
      "warrior",
      "momentum",
      "Momentum",
      "The first swing of Whirlwind is never the last you have in you.",
      1,
      extraCharges("warrior_whirlwind"),
    ],
    ["rogue", "cutthroat", "Cutthroat", "You don't need much of an opening.", TALENT_MAX_RANK, statBonus("critChanceBonus", 0.6)],
    [
      "rogue",
      "vicious_strikes",
      "Vicious Strikes",
      "Precision over brute force.",
      TALENT_MAX_RANK,
      statBonus("damagePercent", 1.5),
    ],
    [
      "rogue",
      "grim_endurance",
      "Grim Endurance",
      "A life of close calls builds a thick skin.",
      TALENT_MAX_RANK,
      statBonus("maxHpPercent", 1.25),
    ],
    [
      "rogue",
      "fleet_footed",
      "Fleet Footed",
      "Garrote a target and you're already three steps from where they think you are.",
      1,
      onCastBuff("rogue_garrote", "shadowStep"),
    ],
    [
      "rogue",
      "opportunist",
      "Opportunist",
      "One blade finds the opening; the second is already moving.",
      1,
      extraCharges("rogue_backstab"),
    ],
    [
      "ranger",
      "marksmans_eye",
      "Marksman's Eye",
      "You aim for the gaps others don't even see.",
      TALENT_MAX_RANK,
      statBonus("critChanceBonus", 0.6),
    ],
    ["ranger", "camouflage", "Camouflage", "Half-seen is half-hit.", TALENT_MAX_RANK, statBonus("armorBonus", 1)],
    [
      "ranger",
      "wilderness_vigor",
      "Wilderness Vigor",
      "Years in the field harden more than just your aim.",
      TALENT_MAX_RANK,
      statBonus("maxHpPercent", 1.25),
    ],
    [
      "ranger",
      "quickdraw",
      "Quickdraw",
      "Nocked, drawn, loosed — before they've registered the threat. An Aimed Shot always has one more arrow behind it.",
      1,
      extraCharges("ranger_aimed_shot"),
    ],
    [
      "ranger",
      "hunters_focus",
      "Hunter's Focus",
      "The trap springs, and everything after it feels slower.",
      1,
      onCastBuff("ranger_explosive_trap", "huntersFocus"),
    ],
    [
      "oracle",
      "focused_mind",
      "Focused Mind",
      "Clarity finds the weak point in anything.",
      TALENT_MAX_RANK,
      statBonus("critChanceBonus", 0.6),
    ],
    [
      "oracle",
      "arcane_insight",
      "Arcane Insight",
      "Understanding is its own weapon.",
      TALENT_MAX_RANK,
      statBonus("damagePercent", 1.5),
    ],
    [
      "oracle",
      "vital_current",
      "Vital Current",
      "Life force ebbs and flows — you've learned to hold onto more of it.",
      TALENT_MAX_RANK,
      statBonus("maxHpPercent", 1.25),
    ],
    [
      "oracle",
      "swift_rites",
      "Swift Rites",
      "The words come easier with practice — Renew is never fully spent.",
      1,
      extraCharges("oracle_renew"),
    ],
    [
      "oracle",
      "warding_sigil",
      "Warding Sigil",
      "Smite carves an opening, and a shimmer of protection follows you through it.",
      1,
      onCastBuff("oracle_smite", "divineFavor"),
    ],
    [
      "mage",
      "piercing_cold",
      "Piercing Cold",
      "Ice finds every crack.",
      TALENT_MAX_RANK,
      statBonus("critChanceBonus", 0.6),
    ],
    [
      "mage",
      "arcane_power",
      "Arcane Power",
      "Raw force, barely contained.",
      TALENT_MAX_RANK,
      statBonus("damagePercent", 1.5),
    ],
    ["mage", "mana_shield", "Mana Shield", "A thin barrier is still a barrier.", TALENT_MAX_RANK, statBonus("armorBonus", 1)],
    [
      "mage",
      "overchannel",
      "Overchannel",
      "You've stopped waiting for the mana to settle — Frostbolt can be loosed twice before it does.",
      1,
      extraCharges("mage_frostbolt"),
    ],
    [
      "mage",
      "deep_reserves",
      "Deep Reserves",
      "Blizzard draws from a well deeper than you let on.",
      1,
      onCastBuff("mage_blizzard", "arcaneSurge"),
    ],
  ];
  for (const [classId, slug, name, description, maxRank, effect] of talentDefs) {
    const id = `${classId}_${slug}`;
    const row = {
      id,
      class_id: classId,
      name,
      description,
      max_rank: maxRank,
      effect,
    };
    await prisma.talent.upsert({ where: { id }, create: row, update: row });
  }

  // --- Enemy types ---
  // "boss" is the overworld world-boss; "dungeon_boss" is the dungeon's own mini-boss - same
  // attack patterns, lower HP (was a separately-hardcoded BOSS_MAX_HP=350 before this migration).
  const enemyTypes = [
    {
      id: "melee",
      name: "Melee Enemy",
      behavior: "melee",
      xp_reward: 20,
      gold_reward: 5,
      stats: { maxHp: 40, damage: 8, range: 1.8, intervalMs: 1500 },
    },
    {
      id: "caster",
      name: "Caster Enemy",
      behavior: "caster",
      xp_reward: 30,
      gold_reward: 8,
      stats: { maxHp: 25, damage: 6, range: 10, cooldownMs: 2200, projectileSpeed: 6, castTimeMs: 1000 },
    },
    {
      id: "boss",
      name: "The Ashen Warden",
      behavior: "boss",
      xp_reward: 300,
      gold_reward: 100,
      stats: {
        maxHp: 500,
        meleeDamage: 16,
        meleeRange: 2.2,
        meleeIntervalMs: 1400,
        aoeDamage: 20,
        aoeRadius: 4,
        aoeRange: 12,
        aoeCooldownMs: 6000,
        aoeCastTimeMs: 1200,
        aoeProjectileSpeed: 8,
      },
    },
    {
      id: "dungeon_boss",
      name: "The Ashen Warden",
      behavior: "boss",
      xp_reward: 300,
      gold_reward: 100,
      stats: {
        maxHp: 350,
        meleeDamage: 16,
        meleeRange: 2.2,
        meleeIntervalMs: 1400,
        aoeDamage: 20,
        aoeRadius: 4,
        aoeRange: 12,
        aoeCooldownMs: 6000,
        aoeCastTimeMs: 1200,
        aoeProjectileSpeed: 8,
      },
    },
  ];
  for (const e of enemyTypes) {
    await prisma.enemyType.upsert({ where: { id: e.id }, create: e, update: e });
  }

  // --- Maps ---
  const overworld = {
    id: "overworld",
    name: "Overworld",
    kind: "overworld",
    half_extent: 250,
    is_active: true,
    portal_x: -24,
    portal_z: -24,
    boss_arena_x: 0,
    boss_arena_z: 28,
    boss_arena_radius: 10,
  };
  await prisma.gameMap.upsert({ where: { id: overworld.id }, create: overworld, update: overworld });

  const dungeonGround = { id: "dungeon_ground", name: "Dungeon Ground", kind: "dungeon", half_extent: 16, is_active: false };
  await prisma.gameMap.upsert({ where: { id: dungeonGround.id }, create: dungeonGround, update: dungeonGround });

  // --- NPCs ---
  const npcs = [
    { id: "quest_giver", name: "Weary Quartermaster", x: 0, z: -3, map_id: "overworld" },
    { id: "boss_watcher", name: "Scarred Sentinel", x: 0, z: 20, map_id: "overworld" },
    { id: "merchant", name: "Traveling Merchant", x: -6, z: -3, map_id: "overworld" },
  ];
  for (const n of npcs) {
    await prisma.npc.upsert({ where: { id: n.id }, create: n, update: n });
  }

  // Merchant sells every item except warden_relic (a unique boss-quest reward).
  await prisma.npcVendorItem.deleteMany({ where: { npc_id: "merchant" } });
  await prisma.npcVendorItem.createMany({
    data: items.filter((i) => i.id !== "warden_relic").map((i) => ({ npc_id: "merchant", item_id: i.id })),
  });

  // --- Quests ---
  const quests = [
    {
      id: "kill_melee_3",
      name: "Thin the Ranks",
      description: "Melee attackers keep probing the perimeter. Kill 3 of them.",
      giver_npc_id: "quest_giver",
      objective_enemy_type_id: "melee",
      objective_count: 3,
      reward_xp: 150,
      reward_item_id: "lucky_charm",
    },
    {
      id: "kill_caster_3",
      name: "Silence the Casters",
      description: "Enemy casters are the bigger threat. Kill 3 of them.",
      giver_npc_id: "quest_giver",
      objective_enemy_type_id: "caster",
      objective_count: 3,
      reward_xp: 200,
      reward_item_id: "signet_ring",
    },
    {
      id: "defeat_boss",
      name: "The Ashen Warden",
      description: "A monstrous warden has claimed the ruins to the north. End its watch - bring friends.",
      giver_npc_id: "boss_watcher",
      objective_enemy_type_id: "boss",
      objective_count: 1,
      reward_xp: 500,
      reward_item_id: "warden_relic",
    },
  ];
  for (const q of quests) {
    await prisma.quest.upsert({ where: { id: q.id }, create: q, update: q });
  }

  // --- Enemy spawns (overworld) ---
  const spawns = [
    { id: "melee-1", map_id: "overworld", enemy_type_id: "melee", x: 8, z: 8 },
    { id: "melee-2", map_id: "overworld", enemy_type_id: "melee", x: -8, z: 8 },
    { id: "caster-1", map_id: "overworld", enemy_type_id: "caster", x: 8, z: -8 },
    { id: "caster-2", map_id: "overworld", enemy_type_id: "caster", x: -8, z: -8 },
    { id: "boss-1", map_id: "overworld", enemy_type_id: "boss", x: 0, z: 28, respawn_ms: 60_000 },
  ];
  for (const s of spawns) {
    await prisma.enemySpawn.upsert({ where: { id: s.id }, create: s, update: s });
  }

  // --- Structures (a small starter town near the quest_giver/merchant cluster - one of each
  // kind, meant as a copyable example for building out bigger cities via the admin panel).
  // Sized/spaced to clear the fixed enemy spawns at (+-8, +-8) with margin to spare - nothing
  // about structure size is capped anywhere in the code, these are just bigger example values. ---
  const structures = [
    { id: "house_1", name: "Quartermaster's House", map_id: "overworld", kind: "house", x: 3, z: -13, rotation_y: 0, width: 6, depth: 6, height: 4.5, color: "#8a6d4b" },
    { id: "house_2", name: "Traveler's Cottage", map_id: "overworld", kind: "house", x: -15, z: -13, rotation_y: 0.3, width: 6, depth: 6, height: 4.5, color: "#9c7a52" },
    { id: "merchant_shop", name: "Traveling Merchant's Shop", map_id: "overworld", kind: "shop", x: -14, z: 1, rotation_y: -0.4, width: 8, depth: 6, height: 5, color: "#5c7a99" },
    { id: "town_wall", name: "Town Wall", map_id: "overworld", kind: "wall", x: -3, z: -19, rotation_y: 0, width: 22, depth: 1.2, height: 4, color: "#7d7d7d" },
    { id: "town_gate", name: "Town Gate", map_id: "overworld", kind: "gate", x: -3, z: -9, rotation_y: 0, width: 6, depth: 1.2, height: 5.5, color: "#6b6b6b" },
    { id: "watch_tower", name: "Sentinel's Watchtower", map_id: "overworld", kind: "tower", x: 6, z: 22, rotation_y: 0, width: 4, depth: 4, height: 12, color: "#6e6a63" },
  ];
  for (const s of structures) {
    await prisma.structure.upsert({ where: { id: s.id }, create: s, update: s });
  }

  // --- Dungeon ---
  const dungeon = {
    id: "ashen_ruins",
    name: "The Ashen Ruins",
    map_id: "dungeon_ground",
    is_active: true,
    party_size: 4,
    composition: { tank: 1, healer: 1, dps: 2 },
    encounters: [
      [
        { enemyTypeId: "melee", x: -1.5, z: 8 },
        { enemyTypeId: "melee", x: 1.5, z: 8 },
      ],
      [
        { enemyTypeId: "melee", x: -1.5, z: 8 },
        { enemyTypeId: "caster", x: 1.5, z: 8 },
      ],
      [{ enemyTypeId: "dungeon_boss", x: 0, z: 8 }],
    ],
  };
  await prisma.dungeon.upsert({ where: { id: dungeon.id }, create: dungeon, update: dungeon });

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
