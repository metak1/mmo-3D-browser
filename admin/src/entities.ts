export type FieldType = "text" | "textarea" | "number" | "boolean" | "select" | "json" | "reference" | "multiselect";

export interface FieldSchema {
  key: string; // matches the admin API's field name (snake_case, mirrors the DB column)
  label: string;
  type: FieldType;
  options?: string[]; // for "select"
  referenceEntity?: string; // for "reference"/"multiselect" - which entity's list to pick from
  optional?: boolean;
}

export interface EntitySchema {
  key: string; // admin API path segment, e.g. "enemy-types"
  label: string;
  displayField: string; // which field to show alongside the id in tables/reference dropdowns
  fields: FieldSchema[];
  hasActivate?: boolean; // maps/dungeons - "exactly one active" is managed via a dedicated action
}

export const ENTITIES: EntitySchema[] = [
  {
    key: "classes",
    label: "Classes",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "main_stat", label: "Main Stat", type: "select", options: ["strength", "dexterity", "intellect"] },
      { key: "role", label: "Role", type: "select", options: ["tank", "healer", "dps"] },
    ],
  },
  {
    key: "spells",
    label: "Spells",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "class_id", label: "Class", type: "reference", referenceEntity: "classes" },
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "effect_type", label: "Effect Type", type: "select", options: ["damage", "heal", "dispel", "interrupt"] },
      { key: "target_type", label: "Target Type", type: "select", options: ["enemy", "ally", "self", "ground"] },
      { key: "amount", label: "Amount", type: "number", optional: true },
      { key: "aoe_radius", label: "AoE Radius", type: "number", optional: true },
      { key: "interrupts_cast", label: "Interrupts Cast", type: "boolean", optional: true },
      { key: "cooldown_ms", label: "Cooldown (ms)", type: "number" },
      { key: "cast_time_ms", label: "Cast Time (ms)", type: "number" },
      { key: "range", label: "Range", type: "number" },
      { key: "projectile_speed", label: "Projectile Speed", type: "number", optional: true },
    ],
  },
  {
    key: "items",
    label: "Items",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "slot", label: "Slot", type: "select", options: ["weapon", "armor", "trinket"] },
      { key: "bonuses", label: "Bonuses", type: "json" },
      { key: "icon", label: "Icon (emoji)", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "base_price", label: "Base Price", type: "number" },
    ],
  },
  {
    key: "talents",
    label: "Talents",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "class_id", label: "Class", type: "reference", referenceEntity: "classes" },
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "max_rank", label: "Max Rank", type: "number" },
      { key: "effect", label: "Effect", type: "json" },
      { key: "tier", label: "Tier (tree row, 1-based)", type: "number" },
      { key: "column_index", label: "Column (0-based, within the row)", type: "number" },
      {
        key: "prerequisite_talent_id",
        label: "Prerequisite Talent (must have 1+ rank to unlock this node)",
        type: "reference",
        referenceEntity: "talents",
        optional: true,
      },
    ],
  },
  {
    key: "enemy-types",
    label: "Enemy Types",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "behavior", label: "Behavior", type: "select", options: ["melee", "caster", "boss"] },
      { key: "xp_reward", label: "XP Reward", type: "number" },
      { key: "gold_reward", label: "Gold Reward", type: "number" },
      { key: "stats", label: "Stats (shape depends on behavior)", type: "json" },
    ],
  },
  {
    key: "enemy-spawns",
    label: "Enemy Spawns",
    displayField: "id",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "map_id", label: "Map", type: "reference", referenceEntity: "maps" },
      { key: "enemy_type_id", label: "Enemy Type", type: "reference", referenceEntity: "enemy-types" },
      { key: "x", label: "X", type: "number" },
      { key: "z", label: "Z", type: "number" },
      { key: "respawn_ms", label: "Respawn (ms)", type: "number", optional: true },
    ],
  },
  {
    key: "npcs",
    label: "NPCs",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "x", label: "X", type: "number" },
      { key: "z", label: "Z", type: "number" },
      { key: "y_offset", label: "Y Offset", type: "number", optional: true },
      { key: "map_id", label: "Map", type: "reference", referenceEntity: "maps" },
      {
        key: "vendor_item_ids",
        label: "Sells (leave empty if not a vendor)",
        type: "multiselect",
        referenceEntity: "items",
        optional: true,
      },
    ],
  },
  {
    key: "quests",
    label: "Quests",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "giver_npc_id", label: "Giver NPC", type: "reference", referenceEntity: "npcs" },
      { key: "objective_enemy_type_id", label: "Objective Enemy Type", type: "reference", referenceEntity: "enemy-types" },
      { key: "objective_count", label: "Objective Count", type: "number" },
      { key: "reward_xp", label: "Reward XP", type: "number" },
      { key: "reward_item_id", label: "Reward Item", type: "reference", referenceEntity: "items", optional: true },
    ],
  },
  {
    key: "maps",
    label: "Maps",
    displayField: "name",
    hasActivate: true,
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "kind", label: "Kind", type: "select", options: ["overworld", "dungeon"] },
      { key: "half_extent", label: "Half Extent", type: "number" },
      { key: "portal_x", label: "Portal X", type: "number", optional: true },
      { key: "portal_z", label: "Portal Z", type: "number", optional: true },
      { key: "boss_arena_x", label: "Boss Arena X", type: "number", optional: true },
      { key: "boss_arena_z", label: "Boss Arena Z", type: "number", optional: true },
      { key: "boss_arena_radius", label: "Boss Arena Radius", type: "number", optional: true },
    ],
  },
  {
    key: "structures",
    label: "Structures",
    displayField: "name",
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "map_id", label: "Map", type: "reference", referenceEntity: "maps" },
      { key: "kind", label: "Kind", type: "select", options: ["house", "shop", "wall", "tower", "gate"] },
      { key: "x", label: "X", type: "number" },
      { key: "z", label: "Z", type: "number" },
      { key: "rotation_y", label: "Rotation Y (radians)", type: "number", optional: true },
      { key: "width", label: "Width", type: "number" },
      { key: "depth", label: "Depth", type: "number" },
      { key: "height", label: "Height", type: "number" },
      { key: "color", label: "Color (hex)", type: "text" },
      { key: "y_offset", label: "Y Offset", type: "number", optional: true },
    ],
  },
  {
    key: "dungeons",
    label: "Dungeons",
    displayField: "name",
    hasActivate: true,
    fields: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "map_id", label: "Map", type: "reference", referenceEntity: "maps" },
      { key: "party_size", label: "Party Size", type: "number" },
      { key: "composition", label: "Composition (Record<role, count>)", type: "json" },
      { key: "encounters", label: "Encounters (ordered waves)", type: "json" },
    ],
  },
];
