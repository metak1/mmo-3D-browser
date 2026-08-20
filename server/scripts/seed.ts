// Idempotent (every row is an upsert keyed by its content id) - inserts the exact content that
// used to be hardcoded in shared/src/types.ts, so the game's live behavior is unchanged
// immediately after migrating. See the "Admin Content Backend" plan. Safe to re-run.
import "../src/env.js";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function upsert(table: string, row: Record<string, unknown>, jsonColumns: string[] = []): Promise<void> {
  const columns = Object.keys(row);
  const values = columns.map((c) => (jsonColumns.includes(c) ? JSON.stringify(row[c]) : row[c]));
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const updates = columns.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  await pool.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  );
}

async function setVendorCatalog(npcId: string, itemIds: string[]): Promise<void> {
  await pool.query("DELETE FROM npc_vendor_items WHERE npc_id = $1", [npcId]);
  if (itemIds.length > 0) {
    const values = itemIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(`INSERT INTO npc_vendor_items (npc_id, item_id) VALUES ${values}`, [npcId, ...itemIds]);
  }
}

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
    await upsert("game_classes", c);
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
    await upsert("spells", s);
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
    // --- Leveling-path rewards (see quests below) - each roughly double the previous tier's
    // bonuses, so a quest reward always feels like a real upgrade over what a starting-town
    // vendor sells, not just a reskinned rusty_sword.
    {
      id: "reinforced_platemail",
      name: "Reinforced Platemail",
      slot: "armor",
      bonuses: { armor: 10, vitality: 4 },
      icon: "🛡️",
      description: "Keep-forged plate, dented from the trolls that failed to dent the wearer.",
      base_price: 90,
    },
    {
      id: "staff_of_embers",
      name: "Staff of Embers",
      slot: "weapon",
      bonuses: { mainStat: 8 },
      icon: "🔥",
      description: "Still warm from the cultist who last carried it.",
      base_price: 100,
    },
    {
      id: "frostguard_amulet",
      name: "Frostguard Amulet",
      slot: "trinket",
      bonuses: { vitality: 6, armor: 4 },
      icon: "❄️",
      description: "Carved from a giant's tusk, cold to everyone but its wearer.",
      base_price: 130,
    },
    {
      id: "crown_of_the_north",
      name: "Crown of the North",
      slot: "trinket",
      bonuses: { mainStat: 10, vitality: 6, luck: 4 },
      icon: "👑",
      description: "Frosthold's last relic of the age before the giants came south.",
      base_price: 250,
    },
  ];
  for (const i of items) {
    await upsert("items", i, ["bonuses"]);
  }

  // --- Talents: a real tree per class, 2 tiers deep. Tier 1 is 3 side-by-side flat statBonus
  // nodes (maxRank 12, no prerequisite - always spendable). Tier 2 holds the two "signature"
  // mechanics (extraCharges, onCastBuff) at maxRank 1 - each sits directly under, and requires
  // >=1 point in, a specific tier-1 node (see prerequisiteSlug), mirroring modern WoW's
  // single-prerequisite-connection talent trees rather than classic's cumulative-points-per-row
  // gating. isTalentUnlocked (shared/src/types.ts) is what actually enforces the connection.
  const TALENT_MAX_RANK = 12;
  type TalentEffectSeed =
    | { kind: "statBonus"; stat: string; perRank: number }
    | { kind: "extraCharges"; spellId: string; perRank: number }
    | { kind: "onCastBuff"; spellId: string; buffId: string };
  const statBonus = (stat: string, perRank: number): TalentEffectSeed => ({ kind: "statBonus", stat, perRank });
  const extraCharges = (spellId: string, perRank = 1): TalentEffectSeed => ({ kind: "extraCharges", spellId, perRank });
  const onCastBuff = (spellId: string, buffId: string): TalentEffectSeed => ({ kind: "onCastBuff", spellId, buffId });

  interface TalentDefSeed {
    classId: string;
    slug: string;
    name: string;
    description: string;
    maxRank: number;
    effect: TalentEffectSeed;
    tier: number;
    column: number;
    prerequisiteSlug?: string;
  }
  const talentDefs: TalentDefSeed[] = [
    // --- Warrior ---
    {
      classId: "warrior",
      slug: "iron_skin",
      name: "Iron Skin",
      description: "Years of taking hits taught your body to shrug them off.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("armorBonus", 1),
      tier: 1,
      column: 0,
    },
    {
      classId: "warrior",
      slug: "crushing_blows",
      name: "Crushing Blows",
      description: "Every swing carries a little more weight.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("damagePercent", 1.5),
      tier: 1,
      column: 1,
    },
    {
      classId: "warrior",
      slug: "stalwart_heart",
      name: "Stalwart Heart",
      description: "Your resolve keeps you standing after lesser warriors would fall.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("maxHpPercent", 1.25),
      tier: 1,
      column: 2,
    },
    {
      classId: "warrior",
      slug: "momentum",
      name: "Momentum",
      description: "The first swing of Whirlwind is never the last you have in you.",
      maxRank: 1,
      effect: extraCharges("warrior_whirlwind"),
      tier: 2,
      column: 1,
      prerequisiteSlug: "crushing_blows",
    },
    {
      classId: "warrior",
      slug: "battle_fury",
      name: "Battle Fury",
      description: "A well-placed Shield Bash leaves you charged with momentum.",
      maxRank: 1,
      effect: onCastBuff("warrior_shield_bash", "battleFury"),
      tier: 2,
      column: 2,
      prerequisiteSlug: "stalwart_heart",
    },
    // --- Rogue ---
    {
      classId: "rogue",
      slug: "cutthroat",
      name: "Cutthroat",
      description: "You don't need much of an opening.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("critChanceBonus", 0.6),
      tier: 1,
      column: 0,
    },
    {
      classId: "rogue",
      slug: "vicious_strikes",
      name: "Vicious Strikes",
      description: "Precision over brute force.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("damagePercent", 1.5),
      tier: 1,
      column: 1,
    },
    {
      classId: "rogue",
      slug: "grim_endurance",
      name: "Grim Endurance",
      description: "A life of close calls builds a thick skin.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("maxHpPercent", 1.25),
      tier: 1,
      column: 2,
    },
    {
      classId: "rogue",
      slug: "opportunist",
      name: "Opportunist",
      description: "One blade finds the opening; the second is already moving.",
      maxRank: 1,
      effect: extraCharges("rogue_backstab"),
      tier: 2,
      column: 1,
      prerequisiteSlug: "vicious_strikes",
    },
    {
      classId: "rogue",
      slug: "fleet_footed",
      name: "Fleet Footed",
      description: "Garrote a target and you're already three steps from where they think you are.",
      maxRank: 1,
      effect: onCastBuff("rogue_garrote", "shadowStep"),
      tier: 2,
      column: 2,
      prerequisiteSlug: "grim_endurance",
    },
    // --- Ranger ---
    {
      classId: "ranger",
      slug: "marksmans_eye",
      name: "Marksman's Eye",
      description: "You aim for the gaps others don't even see.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("critChanceBonus", 0.6),
      tier: 1,
      column: 0,
    },
    {
      classId: "ranger",
      slug: "camouflage",
      name: "Camouflage",
      description: "Half-seen is half-hit.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("armorBonus", 1),
      tier: 1,
      column: 1,
    },
    {
      classId: "ranger",
      slug: "wilderness_vigor",
      name: "Wilderness Vigor",
      description: "Years in the field harden more than just your aim.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("maxHpPercent", 1.25),
      tier: 1,
      column: 2,
    },
    {
      classId: "ranger",
      slug: "quickdraw",
      name: "Quickdraw",
      description: "Nocked, drawn, loosed — before they've registered the threat. An Aimed Shot always has one more arrow behind it.",
      maxRank: 1,
      effect: extraCharges("ranger_aimed_shot"),
      tier: 2,
      column: 1,
      prerequisiteSlug: "camouflage",
    },
    {
      classId: "ranger",
      slug: "hunters_focus",
      name: "Hunter's Focus",
      description: "The trap springs, and everything after it feels slower.",
      maxRank: 1,
      effect: onCastBuff("ranger_explosive_trap", "huntersFocus"),
      tier: 2,
      column: 2,
      prerequisiteSlug: "wilderness_vigor",
    },
    // --- Oracle ---
    {
      classId: "oracle",
      slug: "focused_mind",
      name: "Focused Mind",
      description: "Clarity finds the weak point in anything.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("critChanceBonus", 0.6),
      tier: 1,
      column: 0,
    },
    {
      classId: "oracle",
      slug: "arcane_insight",
      name: "Arcane Insight",
      description: "Understanding is its own weapon.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("damagePercent", 1.5),
      tier: 1,
      column: 1,
    },
    {
      classId: "oracle",
      slug: "vital_current",
      name: "Vital Current",
      description: "Life force ebbs and flows — you've learned to hold onto more of it.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("maxHpPercent", 1.25),
      tier: 1,
      column: 2,
    },
    {
      classId: "oracle",
      slug: "swift_rites",
      name: "Swift Rites",
      description: "The words come easier with practice — Renew is never fully spent.",
      maxRank: 1,
      effect: extraCharges("oracle_renew"),
      tier: 2,
      column: 1,
      prerequisiteSlug: "arcane_insight",
    },
    {
      classId: "oracle",
      slug: "warding_sigil",
      name: "Warding Sigil",
      description: "Smite carves an opening, and a shimmer of protection follows you through it.",
      maxRank: 1,
      effect: onCastBuff("oracle_smite", "divineFavor"),
      tier: 2,
      column: 2,
      prerequisiteSlug: "vital_current",
    },
    // --- Mage ---
    {
      classId: "mage",
      slug: "piercing_cold",
      name: "Piercing Cold",
      description: "Ice finds every crack.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("critChanceBonus", 0.6),
      tier: 1,
      column: 0,
    },
    {
      classId: "mage",
      slug: "arcane_power",
      name: "Arcane Power",
      description: "Raw force, barely contained.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("damagePercent", 1.5),
      tier: 1,
      column: 1,
    },
    {
      classId: "mage",
      slug: "mana_shield",
      name: "Mana Shield",
      description: "A thin barrier is still a barrier.",
      maxRank: TALENT_MAX_RANK,
      effect: statBonus("armorBonus", 1),
      tier: 1,
      column: 2,
    },
    {
      classId: "mage",
      slug: "overchannel",
      name: "Overchannel",
      description: "You've stopped waiting for the mana to settle — Frostbolt can be loosed twice before it does.",
      maxRank: 1,
      effect: extraCharges("mage_frostbolt"),
      tier: 2,
      column: 1,
      prerequisiteSlug: "arcane_power",
    },
    {
      classId: "mage",
      slug: "deep_reserves",
      name: "Deep Reserves",
      description: "Blizzard draws from a well deeper than you let on.",
      maxRank: 1,
      effect: onCastBuff("mage_blizzard", "arcaneSurge"),
      tier: 2,
      column: 2,
      prerequisiteSlug: "mana_shield",
    },
  ];
  for (const def of talentDefs) {
    const id = `${def.classId}_${def.slug}`;
    const row = {
      id,
      class_id: def.classId,
      name: def.name,
      description: def.description,
      max_rank: def.maxRank,
      effect: def.effect,
      tier: def.tier,
      column_index: def.column,
      prerequisite_talent_id: def.prerequisiteSlug ? `${def.classId}_${def.prerequisiteSlug}` : null,
    };
    await upsert("talents", row, ["effect"]);
  }

  // --- Enemy types ---
  // "boss" is the overworld world-boss; "dungeon_boss" is the dungeon's own mini-boss - same
  // attack patterns, lower HP (was a separately-hardcoded BOSS_MAX_HP=350 before this migration).
  // Both share the same special-spell rotation (see BossAbilityDef in shared/src/types.ts) -
  // cycled in order every specialCooldownMs, independent of the phase-2 aoe/enrage/add-spawn
  // mechanics already on BossStats.
  const bossSpecialAbilities = [
    { id: "ashen_nova", name: "Ashen Nova", kind: "raidNova", damage: 14, radius: 6, castTimeMs: 1500 },
    { id: "wardens_judgment", name: "Warden's Judgment", kind: "singleTargetBurst", damage: 40, castTimeMs: 1800 },
  ];

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
        addEnemyTypeId: "melee",
        addIntervalMs: 25_000,
        addCount: 2,
        maxConcurrentAdds: 4,
        specialAbilities: bossSpecialAbilities,
        specialCooldownMs: 20_000,
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
        addEnemyTypeId: "melee",
        addIntervalMs: 25_000,
        addCount: 2,
        maxConcurrentAdds: 4,
        specialAbilities: bossSpecialAbilities,
        specialCooldownMs: 20_000,
      },
    },
    // --- Leveling-path enemies (see the quest chain below) - roughly one tier per new city,
    // each meaningfully tougher than the last so the path's difficulty tracks its reward xp.
    // From here on (wolf onward) every type is aggressive (aggroRange set) - matches each one's
    // own flavor text ("shadowing travelers", "raiding the trade road", etc.) and ramps up the
    // danger of venturing further from town, on top of the starting melee/caster pair (and boss)
    // staying passive so a brand-new player isn't ambushed near spawn.
    {
      id: "wolf",
      name: "Dire Wolf",
      behavior: "melee",
      xp_reward: 25,
      gold_reward: 6,
      stats: { maxHp: 55, damage: 9, range: 1.6, intervalMs: 1300, aggroRange: 7 },
    },
    {
      id: "bandit",
      name: "Bandit Thug",
      behavior: "melee",
      xp_reward: 55,
      gold_reward: 15,
      stats: { maxHp: 90, damage: 14, range: 1.8, intervalMs: 1400, aggroRange: 8 },
    },
    {
      id: "bandit_archer",
      name: "Bandit Archer",
      behavior: "caster",
      xp_reward: 65,
      gold_reward: 18,
      stats: { maxHp: 60, damage: 12, range: 12, cooldownMs: 2000, projectileSpeed: 7, castTimeMs: 900, aggroRange: 10 },
    },
    {
      id: "troll",
      name: "Cave Troll",
      behavior: "melee",
      xp_reward: 120,
      gold_reward: 35,
      stats: { maxHp: 180, damage: 22, range: 2, intervalMs: 1500, aggroRange: 8 },
    },
    {
      id: "dark_mage",
      name: "Dark Cultist",
      behavior: "caster",
      xp_reward: 140,
      gold_reward: 40,
      stats: { maxHp: 130, damage: 20, range: 11, cooldownMs: 1800, projectileSpeed: 8, castTimeMs: 950, aggroRange: 9 },
    },
    {
      id: "frost_giant",
      name: "Frost Giant",
      behavior: "melee",
      xp_reward: 220,
      gold_reward: 70,
      stats: { maxHp: 320, damage: 30, range: 2.2, intervalMs: 1600, aggroRange: 9 },
    },
  ];
  for (const e of enemyTypes) {
    await upsert("enemy_types", e, ["stats"]);
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
  await upsert("game_maps", overworld);

  const dungeonGround = { id: "dungeon_ground", name: "Dungeon Ground", kind: "dungeon", half_extent: 70, is_active: false };
  await upsert("game_maps", dungeonGround);

  // --- NPCs ---
  const npcs = [
    { id: "quest_giver", name: "Weary Quartermaster", x: 0, z: -3, map_id: "overworld" },
    { id: "boss_watcher", name: "Scarred Sentinel", x: 0, z: 20, map_id: "overworld" },
    { id: "merchant", name: "Traveling Merchant", x: -6, z: -3, map_id: "overworld" },
    // --- Leveling-path cities - each pairs one quest giver with one vendor, same "different
    // kinds of NPCs" split as the starting town, so every city reads the same way once you
    // arrive: someone with work for you, someone selling gear for the coin it pays.
    { id: "elara", name: "Ranger Elara", x: 70, z: -15, map_id: "overworld" },
    { id: "millbrook_trader", name: "Millbrook Trader", x: 70, z: -7, map_id: "overworld" },
    { id: "kael", name: "Sergeant Kael", x: 140, z: 43, map_id: "overworld" },
    { id: "ashford_quartermaster", name: "Keep Quartermaster", x: 140, z: 53, map_id: "overworld" },
    { id: "frostbeard", name: "Elder Frostbeard", x: -150, z: 93, map_id: "overworld" },
    { id: "frosthold_trader", name: "Frosthold Trader", x: -150, z: 103, map_id: "overworld" },
    // --- Flavor NPCs - no quest, no vendor catalog, just bodies standing around so each city
    // doesn't read as two or three lonely quest-givers in an empty lot. Paired with the new
    // buildings below (each new building gets an NPC standing near/inside it).
    { id: "blacksmith", name: "Town Blacksmith", x: 20, z: -14, map_id: "overworld" },
    { id: "town_villager", name: "Local Villager", x: -9, z: -13, map_id: "overworld" },
    { id: "millbrook_innkeeper", name: "Millbrook Innkeeper", x: 58, z: -9, map_id: "overworld" },
    { id: "millbrook_stablehand", name: "Stable Hand", x: 73, z: -16, map_id: "overworld" },
    { id: "ashford_guard", name: "Barracks Guard", x: 126, z: 48, map_id: "overworld" },
    { id: "ashford_squire", name: "Keep Squire", x: 140, z: 42, map_id: "overworld" },
    { id: "frosthold_trapper", name: "Grizzled Trapper", x: -150, z: 110, map_id: "overworld" },
    { id: "frosthold_apprentice", name: "Frostbeard's Apprentice", x: -153, z: 100, map_id: "overworld" },
  ];
  for (const n of npcs) {
    await upsert("npcs", n);
  }

  // Merchant sells every item except warden_relic (a unique boss-quest reward).
  await setVendorCatalog(
    "merchant",
    items.filter((i) => i.id !== "warden_relic").map((i) => i.id),
  );

  // Each new-city vendor sells a tier-appropriate slice of the catalog rather than everything -
  // gearing up at Frosthold should feel different from gearing up at Millbrook.
  const vendorCatalogs: Record<string, string[]> = {
    millbrook_trader: ["rusty_sword", "hunting_bow", "apprentice_wand", "leather_vest", "lucky_charm"],
    ashford_quartermaster: ["chainmail_hauberk", "signet_ring", "amulet_of_vigor", "reinforced_platemail"],
    frosthold_trader: ["padded_robe", "staff_of_embers", "frostguard_amulet"],
  };
  for (const [npcId, itemIds] of Object.entries(vendorCatalogs)) {
    await setVendorCatalog(npcId, itemIds);
  }

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
    // --- The leveling path: quest_giver (starting town) points you toward Millbrook, whose
    // quest giver points toward Ashford, whose quest giver points toward Frosthold - a straight
    // line of increasingly dangerous cities, each with two quests against that zone's enemies.
    // There's no hard level-gate (QuestDef has no requiredLevel field, and none of this game's
    // other systems gate by level either) - the enemies' own difficulty is what paces this, same
    // as every other quest here.
    {
      id: "kill_wolf_5",
      name: "Wolves at the Border",
      description: "Wolves have been shadowing travelers on the road east to Millbrook. Kill 5 of them.",
      giver_npc_id: "quest_giver",
      objective_enemy_type_id: "wolf",
      objective_count: 5,
      reward_xp: 300,
      reward_item_id: "leather_vest",
    },
    {
      id: "kill_bandit_5",
      name: "Bandit Trouble",
      description: "Bandits have been raiding the trade road. Kill 5 of them.",
      giver_npc_id: "elara",
      objective_enemy_type_id: "bandit",
      objective_count: 5,
      reward_xp: 500,
      reward_item_id: "hunting_bow",
    },
    {
      id: "kill_bandit_archer_5",
      name: "Silence the Archers",
      description: "The bandits' archers are the ones picking off our scouts. Kill 5 of them.",
      giver_npc_id: "elara",
      objective_enemy_type_id: "bandit_archer",
      objective_count: 5,
      reward_xp: 650,
      reward_item_id: "chainmail_hauberk",
    },
    {
      id: "kill_troll_5",
      name: "Troll Menace",
      description: "Cave trolls have wandered down from the highlands near Ashford. Kill 5 of them.",
      giver_npc_id: "kael",
      objective_enemy_type_id: "troll",
      objective_count: 5,
      reward_xp: 950,
      reward_item_id: "reinforced_platemail",
    },
    {
      id: "kill_dark_mage_6",
      name: "Cult of Ash",
      description: "A cult has taken root in the hills, calling on powers best left alone. Kill 6 of their cultists.",
      giver_npc_id: "kael",
      objective_enemy_type_id: "dark_mage",
      objective_count: 6,
      reward_xp: 1200,
      reward_item_id: "staff_of_embers",
    },
    {
      id: "kill_frost_giant_4",
      name: "Giants of the North",
      description: "Frost giants guard every approach to Frosthold. Kill 4 of them to clear a path.",
      giver_npc_id: "frostbeard",
      objective_enemy_type_id: "frost_giant",
      objective_count: 4,
      reward_xp: 1800,
      reward_item_id: "frostguard_amulet",
    },
    {
      id: "kill_frost_giant_8",
      name: "The Frozen Threat",
      description: "The giants keep coming. Break them for good - kill 8 more.",
      giver_npc_id: "frostbeard",
      objective_enemy_type_id: "frost_giant",
      objective_count: 8,
      reward_xp: 2600,
      reward_item_id: "crown_of_the_north",
    },
  ];
  for (const q of quests) {
    await upsert("quests", q);
  }

  // --- Enemy spawns (overworld) ---
  const spawns = [
    { id: "melee-1", map_id: "overworld", enemy_type_id: "melee", x: 8, z: 8 },
    { id: "melee-2", map_id: "overworld", enemy_type_id: "melee", x: -8, z: 8 },
    { id: "caster-1", map_id: "overworld", enemy_type_id: "caster", x: 8, z: -8 },
    { id: "caster-2", map_id: "overworld", enemy_type_id: "caster", x: -8, z: -8 },
    { id: "boss-1", map_id: "overworld", enemy_type_id: "boss", x: 0, z: 28, respawn_ms: 60_000 },
    // Wolves: the road east from the starting town toward Millbrook.
    { id: "wolf-1", map_id: "overworld", enemy_type_id: "wolf", x: 30, z: -5 },
    { id: "wolf-2", map_id: "overworld", enemy_type_id: "wolf", x: 40, z: -15 },
    { id: "wolf-3", map_id: "overworld", enemy_type_id: "wolf", x: 25, z: 10 },
    // Bandits/archers: the trade road ringing Millbrook.
    { id: "bandit-1", map_id: "overworld", enemy_type_id: "bandit", x: 60, z: -25 },
    { id: "bandit-2", map_id: "overworld", enemy_type_id: "bandit", x: 85, z: -5 },
    { id: "bandit-3", map_id: "overworld", enemy_type_id: "bandit", x: 55, z: 5 },
    { id: "bandit-archer-1", map_id: "overworld", enemy_type_id: "bandit_archer", x: 90, z: -20 },
    { id: "bandit-archer-2", map_id: "overworld", enemy_type_id: "bandit_archer", x: 60, z: 10 },
    // Trolls/dark mages: the highlands around Ashford Keep.
    { id: "troll-1", map_id: "overworld", enemy_type_id: "troll", x: 120, z: 35, respawn_ms: 15_000 },
    { id: "troll-2", map_id: "overworld", enemy_type_id: "troll", x: 160, z: 65, respawn_ms: 15_000 },
    { id: "troll-3", map_id: "overworld", enemy_type_id: "troll", x: 130, z: 70, respawn_ms: 15_000 },
    { id: "dark-mage-1", map_id: "overworld", enemy_type_id: "dark_mage", x: 155, z: 35, respawn_ms: 15_000 },
    { id: "dark-mage-2", map_id: "overworld", enemy_type_id: "dark_mage", x: 125, z: 65, respawn_ms: 15_000 },
    // Frost giants: the approaches to Frosthold - four spawns since the two local quests need
    // 12 kills between them, and a longer respawn so the area doesn't feel like a farming pit.
    { id: "frost-giant-1", map_id: "overworld", enemy_type_id: "frost_giant", x: -130, z: 85, respawn_ms: 25_000 },
    { id: "frost-giant-2", map_id: "overworld", enemy_type_id: "frost_giant", x: -170, z: 115, respawn_ms: 25_000 },
    { id: "frost-giant-3", map_id: "overworld", enemy_type_id: "frost_giant", x: -140, z: 130, respawn_ms: 25_000 },
    { id: "frost-giant-4", map_id: "overworld", enemy_type_id: "frost_giant", x: -165, z: 80, respawn_ms: 25_000 },
  ];
  for (const s of spawns) {
    await upsert("enemy_spawns", s);
  }

  // --- Structures (a small starter town near the quest_giver/merchant cluster - one of each
  // kind, meant as a copyable example for building out bigger cities via the admin panel).
  // Sized/spaced to clear the fixed enemy spawns at (+-8, +-8) with margin to spare - nothing
  // about structure size is capped anywhere in the code, these are just bigger example values.
  //
  // A "house" is no longer its own structure kind (see shared's StructureKind/
  // findStructureLoops) - it's just 4 "wall" segments closed into a loop with one "door" segment
  // on it, exactly what an admin would place by hand via the map editor's "+ wall"/"+ door"
  // buttons. Each room below is the axis-aligned wall+door layout findStructureLoops needs to
  // detect it as a closed loop and auto-generate its floor/roof - a worked example to copy. ---
  // Starting-town buildings below are real KayKit "Medieval Hexagon Pack" models (kind:"building",
  // see shared's StructureKind/client/src/game/Structure.ts's BUILDING_MODELS) instead of
  // hand-assembled wall/door loops - a trial run for replacing this game's procedural-box
  // buildings with off-the-shelf whole-building assets. width/depth/height/color are unused for
  // this kind (still required by the schema) so every row below just carries nominal placeholder
  // values. Millbrook/Ashford Keep/Frosthold below are untouched, still the original wall+door
  // pattern - see that comment further down for how to build a room by hand.
  const structures = [
    {
      id: "house_1",
      name: "Quartermaster's House",
      map_id: "overworld",
      kind: "building",
      model_id: "building_home_A_blue",
      x: 3,
      z: -13,
      rotation_y: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: "#ffffff",
    },
    {
      id: "house_2",
      name: "Traveler's Cottage",
      map_id: "overworld",
      kind: "building",
      model_id: "building_home_B_blue",
      x: -15,
      z: -13,
      rotation_y: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: "#ffffff",
    },
    {
      id: "merchant_shop",
      name: "Traveling Merchant's Shop",
      map_id: "overworld",
      kind: "building",
      model_id: "building_market_blue",
      x: -14,
      z: 1,
      rotation_y: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: "#ffffff",
    },
    { id: "town_wall", name: "Town Wall", map_id: "overworld", kind: "wall", x: -3, z: -19, rotation_y: 0, width: 22, depth: 1.2, height: 4, color: "#7d7d7d" },
    { id: "town_gate", name: "Town Gate", map_id: "overworld", kind: "gate", x: -3, z: -9, rotation_y: 0, width: 6, depth: 1.2, height: 5.5, color: "#6b6b6b" },
    {
      id: "watch_tower",
      name: "Sentinel's Watchtower",
      map_id: "overworld",
      kind: "building",
      model_id: "building_tower_A_blue",
      x: 6,
      z: 22,
      rotation_y: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: "#ffffff",
    },
    {
      id: "blacksmith",
      name: "Blacksmith's Forge",
      map_id: "overworld",
      kind: "building",
      model_id: "building_blacksmith_blue",
      x: 20,
      z: -13,
      rotation_y: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: "#ffffff",
    },
    // --- Millbrook (trading outpost, x~70/z~-10) - one room, no perimeter, matches its role as
    // a small waystation rather than a fortified city. ---
    { id: "millbrook_hall_wall_front_l", name: "Millbrook Trading Hall (front-left)", map_id: "overworld", kind: "wall", x: 67.85, z: -13.5, rotation_y: 0, width: 2.7, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    { id: "millbrook_hall_door", name: "Millbrook Trading Hall (door)", map_id: "overworld", kind: "door", x: 70, z: -13.5, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    { id: "millbrook_hall_wall_front_r", name: "Millbrook Trading Hall (front-right)", map_id: "overworld", kind: "wall", x: 72.15, z: -13.5, rotation_y: 0, width: 2.7, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    { id: "millbrook_hall_wall_back", name: "Millbrook Trading Hall (back)", map_id: "overworld", kind: "wall", x: 70, z: -6.5, rotation_y: 0, width: 7, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    { id: "millbrook_hall_wall_left", name: "Millbrook Trading Hall (left)", map_id: "overworld", kind: "wall", x: 66.5, z: -10, rotation_y: 1.5708, width: 7, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    { id: "millbrook_hall_wall_right", name: "Millbrook Trading Hall (right)", map_id: "overworld", kind: "wall", x: 73.5, z: -10, rotation_y: 1.5708, width: 7, depth: 0.2, height: 3.15, color: "#6b8a5c" },
    // Millbrook Inn (6x6, center 58,-10, door facing -z) - west of the Trading Hall, a second
    // building so the outpost doesn't read as a single room in a field.
    { id: "millbrook_inn_wall_front_l", name: "Millbrook Inn (front-left)", map_id: "overworld", kind: "wall", x: 56.1, z: -13, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    { id: "millbrook_inn_door", name: "Millbrook Inn (door)", map_id: "overworld", kind: "door", x: 58, z: -13, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    { id: "millbrook_inn_wall_front_r", name: "Millbrook Inn (front-right)", map_id: "overworld", kind: "wall", x: 59.9, z: -13, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    { id: "millbrook_inn_wall_back", name: "Millbrook Inn (back)", map_id: "overworld", kind: "wall", x: 58, z: -7, rotation_y: 0, width: 6, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    { id: "millbrook_inn_wall_left", name: "Millbrook Inn (left)", map_id: "overworld", kind: "wall", x: 55, z: -10, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    { id: "millbrook_inn_wall_right", name: "Millbrook Inn (right)", map_id: "overworld", kind: "wall", x: 61, z: -10, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.15, color: "#8a6b4f" },
    // --- Ashford Keep (fortified city, x~140/z~50) - hall plus a tower and a gate marking the
    // approach, reads as more military than Millbrook's single trading hall. ---
    { id: "ashford_hall_wall_front_l", name: "Ashford Keep Hall (front-left)", map_id: "overworld", kind: "wall", x: 137.6, z: 46, rotation_y: 0, width: 3.2, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_hall_door", name: "Ashford Keep Hall (door)", map_id: "overworld", kind: "door", x: 140, z: 46, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_hall_wall_front_r", name: "Ashford Keep Hall (front-right)", map_id: "overworld", kind: "wall", x: 142.4, z: 46, rotation_y: 0, width: 3.2, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_hall_wall_back", name: "Ashford Keep Hall (back)", map_id: "overworld", kind: "wall", x: 140, z: 54, rotation_y: 0, width: 8, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_hall_wall_left", name: "Ashford Keep Hall (left)", map_id: "overworld", kind: "wall", x: 136, z: 50, rotation_y: 1.5708, width: 8, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_hall_wall_right", name: "Ashford Keep Hall (right)", map_id: "overworld", kind: "wall", x: 144, z: 50, rotation_y: 1.5708, width: 8, depth: 0.2, height: 3.5, color: "#5a5a68" },
    { id: "ashford_tower", name: "Ashford Watchtower", map_id: "overworld", kind: "tower", x: 150, z: 50, rotation_y: 0, width: 4, depth: 4, height: 11, color: "#5a5a68" },
    { id: "ashford_gate", name: "Ashford Gate", map_id: "overworld", kind: "gate", x: 140, z: 38, rotation_y: 0, width: 6, depth: 1.2, height: 5.5, color: "#5a5a68" },
    // Ashford Barracks (6x6, center 126,50, door facing -z) - west of the Hall, inside the same
    // walled footprint the Keep's gate/tower already imply.
    { id: "ashford_barracks_wall_front_l", name: "Ashford Barracks (front-left)", map_id: "overworld", kind: "wall", x: 124.1, z: 47, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.5, color: "#4a4a55" },
    { id: "ashford_barracks_door", name: "Ashford Barracks (door)", map_id: "overworld", kind: "door", x: 126, z: 47, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.5, color: "#4a4a55" },
    { id: "ashford_barracks_wall_front_r", name: "Ashford Barracks (front-right)", map_id: "overworld", kind: "wall", x: 127.9, z: 47, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.5, color: "#4a4a55" },
    { id: "ashford_barracks_wall_back", name: "Ashford Barracks (back)", map_id: "overworld", kind: "wall", x: 126, z: 53, rotation_y: 0, width: 6, depth: 0.2, height: 3.5, color: "#4a4a55" },
    { id: "ashford_barracks_wall_left", name: "Ashford Barracks (left)", map_id: "overworld", kind: "wall", x: 123, z: 50, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.5, color: "#4a4a55" },
    { id: "ashford_barracks_wall_right", name: "Ashford Barracks (right)", map_id: "overworld", kind: "wall", x: 129, z: 50, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.5, color: "#4a4a55" },
    // --- Frosthold (northern outpost, x~-150/z~100) - hall plus its own watchtower. ---
    { id: "frosthold_hall_wall_front_l", name: "Frosthold Lodge (front-left)", map_id: "overworld", kind: "wall", x: -152.15, z: 96.5, rotation_y: 0, width: 2.7, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_hall_door", name: "Frosthold Lodge (door)", map_id: "overworld", kind: "door", x: -150, z: 96.5, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_hall_wall_front_r", name: "Frosthold Lodge (front-right)", map_id: "overworld", kind: "wall", x: -147.85, z: 96.5, rotation_y: 0, width: 2.7, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_hall_wall_back", name: "Frosthold Lodge (back)", map_id: "overworld", kind: "wall", x: -150, z: 103.5, rotation_y: 0, width: 7, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_hall_wall_left", name: "Frosthold Lodge (left)", map_id: "overworld", kind: "wall", x: -153.5, z: 100, rotation_y: 1.5708, width: 7, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_hall_wall_right", name: "Frosthold Lodge (right)", map_id: "overworld", kind: "wall", x: -146.5, z: 100, rotation_y: 1.5708, width: 7, depth: 0.2, height: 3.15, color: "#7d97a8" },
    { id: "frosthold_tower", name: "Frosthold Watchtower", map_id: "overworld", kind: "tower", x: -140, z: 100, rotation_y: 0, width: 4, depth: 4, height: 10, color: "#7d97a8" },
    // Trapper's Cabin (6x6, center -150,112, door facing -z, i.e. south toward the Lodge) - a
    // second building north of the Lodge, clear of the frost giant spawns ringing the outpost.
    { id: "frosthold_cabin_wall_front_l", name: "Trapper's Cabin (front-left)", map_id: "overworld", kind: "wall", x: -151.9, z: 109, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.15, color: "#6b7d8a" },
    { id: "frosthold_cabin_door", name: "Trapper's Cabin (door)", map_id: "overworld", kind: "door", x: -150, z: 109, rotation_y: 0, width: 1.6, depth: 0.2, height: 3.15, color: "#6b7d8a" },
    { id: "frosthold_cabin_wall_front_r", name: "Trapper's Cabin (front-right)", map_id: "overworld", kind: "wall", x: -148.1, z: 109, rotation_y: 0, width: 2.2, depth: 0.2, height: 3.15, color: "#6b7d8a" },
    { id: "frosthold_cabin_wall_back", name: "Trapper's Cabin (back)", map_id: "overworld", kind: "wall", x: -150, z: 115, rotation_y: 0, width: 6, depth: 0.2, height: 3.15, color: "#6b7d8a" },
    { id: "frosthold_cabin_wall_left", name: "Trapper's Cabin (left)", map_id: "overworld", kind: "wall", x: -153, z: 112, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.15, color: "#6b7d8a" },
    { id: "frosthold_cabin_wall_right", name: "Trapper's Cabin (right)", map_id: "overworld", kind: "wall", x: -147, z: 112, rotation_y: 1.5708, width: 6, depth: 0.2, height: 3.15, color: "#6b7d8a" },
  ];
  for (const s of structures) {
    await upsert("structures", s);
  }

  // --- Waypoints (fast travel between "cities" - just two example points to start: the town
  // near spawn, and out by the watchtower, standing in for a second settlement. An admin adds
  // more via the map editor's "+ Waypoint" button as more cities get built out.) ---
  const waypoints = [
    { id: "waypoint_town", name: "Town", map_id: "overworld", x: -3, z: -13 },
    { id: "waypoint_watchtower", name: "Watchtower", map_id: "overworld", x: 6, z: 18 },
    { id: "waypoint_millbrook", name: "Millbrook", map_id: "overworld", x: 70, z: -10 },
    { id: "waypoint_ashford", name: "Ashford Keep", map_id: "overworld", x: 140, z: 50 },
    { id: "waypoint_frosthold", name: "Frosthold", map_id: "overworld", x: -150, z: 100 },
  ];
  for (const w of waypoints) {
    await upsert("waypoints", w);
  }

  // --- Furniture (dresses every room's interior - a table facing pair of chairs plus a
  // crate/barrel, bookshelf too in the two bigger rooms - so a house doesn't read as an empty
  // box. Colors match each room's own wall color for a cohesive look. See shared's FurnitureKind/
  // client/src/game/Furniture.ts. Quartermaster's House/Traveler's Cottage/Blacksmith's Forge/
  // Traveling Merchant's Shop have no furniture of their own anymore - they're real whole-building
  // models now (kind:"building", see the structures list above), with no interior to dress.) ---
  const furniture = [
    // Millbrook Trading Hall (7x7, center 70,-10)
    { id: "furn_millbrook_table", name: "Table", map_id: "overworld", kind: "table", x: 70, z: -10, rotation_y: 0, color: "#6b8a5c" },
    { id: "furn_millbrook_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: 70, z: -8.7, rotation_y: 3.1416, color: "#6b8a5c" },
    { id: "furn_millbrook_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: 70, z: -11.3, rotation_y: 0, color: "#6b8a5c" },
    { id: "furn_millbrook_crate", name: "Crate", map_id: "overworld", kind: "crate", x: 72, z: -7.2, rotation_y: 0, color: "#6b8a5c" },
    // Millbrook Inn (6x6, center 58,-10)
    { id: "furn_inn_table", name: "Table", map_id: "overworld", kind: "table", x: 58, z: -10, rotation_y: 0, color: "#8a6b4f" },
    { id: "furn_inn_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: 58, z: -8.7, rotation_y: 3.1416, color: "#8a6b4f" },
    { id: "furn_inn_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: 58, z: -11.3, rotation_y: 0, color: "#8a6b4f" },
    { id: "furn_inn_barrel", name: "Barrel", map_id: "overworld", kind: "barrel", x: 60, z: -7.2, rotation_y: 0, color: "#8a6b4f" },
    // Ashford Keep Hall (8x8, center 140,50)
    { id: "furn_ashford_table", name: "Table", map_id: "overworld", kind: "table", x: 140, z: 50, rotation_y: 0, color: "#5a5a68" },
    { id: "furn_ashford_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: 140, z: 51.5, rotation_y: 3.1416, color: "#5a5a68" },
    { id: "furn_ashford_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: 140, z: 48.5, rotation_y: 0, color: "#5a5a68" },
    { id: "furn_ashford_barrel", name: "Barrel", map_id: "overworld", kind: "barrel", x: 142.5, z: 52.5, rotation_y: 0, color: "#5a5a68" },
    { id: "furn_ashford_bookshelf", name: "Bookshelf", map_id: "overworld", kind: "bookshelf", x: 137.3, z: 50, rotation_y: 1.5708, color: "#5a5a68" },
    // Ashford Barracks (6x6, center 126,50)
    { id: "furn_barracks_table", name: "Table", map_id: "overworld", kind: "table", x: 126, z: 50, rotation_y: 0, color: "#4a4a55" },
    { id: "furn_barracks_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: 126, z: 51.5, rotation_y: 3.1416, color: "#4a4a55" },
    { id: "furn_barracks_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: 126, z: 48.5, rotation_y: 0, color: "#4a4a55" },
    { id: "furn_barracks_crate", name: "Crate", map_id: "overworld", kind: "crate", x: 128.5, z: 52.5, rotation_y: 0, color: "#4a4a55" },
    // Frosthold Lodge (7x7, center -150,100)
    { id: "furn_frosthold_table", name: "Table", map_id: "overworld", kind: "table", x: -150, z: 100, rotation_y: 0, color: "#7d97a8" },
    { id: "furn_frosthold_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: -150, z: 101.3, rotation_y: 3.1416, color: "#7d97a8" },
    { id: "furn_frosthold_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: -150, z: 98.7, rotation_y: 0, color: "#7d97a8" },
    { id: "furn_frosthold_crate", name: "Crate", map_id: "overworld", kind: "crate", x: -148, z: 102.8, rotation_y: 0, color: "#7d97a8" },
    // Trapper's Cabin (6x6, center -150,112)
    { id: "furn_cabin_table", name: "Table", map_id: "overworld", kind: "table", x: -150, z: 112, rotation_y: 0, color: "#6b7d8a" },
    { id: "furn_cabin_chair_a", name: "Chair", map_id: "overworld", kind: "chair", x: -150, z: 113.3, rotation_y: 3.1416, color: "#6b7d8a" },
    { id: "furn_cabin_chair_b", name: "Chair", map_id: "overworld", kind: "chair", x: -150, z: 110.7, rotation_y: 0, color: "#6b7d8a" },
    { id: "furn_cabin_crate", name: "Crate", map_id: "overworld", kind: "crate", x: -148, z: 114.8, rotation_y: 0, color: "#6b7d8a" },
  ];
  for (const f of furniture) {
    await upsert("furniture", f);
  }

  // --- Dungeon (a real space to run through, not a box that dispenses waves - every entry below
  // is a fixed spawn point, live for the whole run from the moment the party enters (see
  // DungeonRoom.spawnDungeonEnemy); trash respawns in place on a timer, the boss doesn't. Laid out
  // in a rough line from the entrance (0,0) out to the boss at the far end, so clearing a path
  // through the trash is what "reaching the boss" actually means, rather than a location that's
  // just decorative.) ---
  const dungeon = {
    id: "ashen_ruins",
    name: "The Ashen Ruins",
    map_id: "dungeon_ground",
    is_active: true,
    party_size: 4,
    composition: { tank: 1, healer: 1, dps: 2 },
    spawns: [
      { id: "trash-1", enemyTypeId: "melee", x: -6, z: 12 },
      { id: "trash-2", enemyTypeId: "melee", x: 6, z: 12 },
      { id: "trash-3", enemyTypeId: "caster", x: 0, z: 22 },
      { id: "trash-4", enemyTypeId: "melee", x: -8, z: 30 },
      { id: "trash-5", enemyTypeId: "caster", x: 8, z: 30 },
      { id: "trash-6", enemyTypeId: "melee", x: -5, z: 42 },
      { id: "trash-7", enemyTypeId: "melee", x: 5, z: 42 },
      { id: "trash-8", enemyTypeId: "caster", x: 0, z: 50 },
      { id: "dungeon-boss", enemyTypeId: "dungeon_boss", x: 0, z: 62 },
    ],
  };
  await upsert("dungeons", dungeon, ["composition", "spawns"]);

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
