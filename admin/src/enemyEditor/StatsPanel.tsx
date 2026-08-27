import { BossAbilityDef, EnemyBehavior } from "@mmo/shared";
import { NumberField } from "../EffectListEditor";
import { AbilityListEditor } from "./AbilityListEditor";

// Replaces the old raw-JSON "stats" textarea with a typed form matching whichever of
// MeleeStats/CasterStats/BossStats (shared/src/types.ts) the enemy's behavior implies. `stats` is
// kept as a loose Record client-side (matching the server's z.record(string, unknown()) schema -
// see server/src/routes/admin/enemyTypes.ts) so switching behavior never throws away fields the
// admin already filled in for a different behavior; only the fields relevant to the current
// behavior are rendered.

function num(stats: Record<string, unknown>, key: string, fallback = 0): number {
  const v = stats[key];
  return typeof v === "number" ? v : fallback;
}

function setNum(stats: Record<string, unknown>, key: string, value: number): Record<string, unknown> {
  return { ...stats, [key]: value };
}

function OptionalNumberField({
  label,
  stats,
  statsKey,
  onChange,
}: {
  label: string;
  stats: Record<string, unknown>;
  statsKey: string;
  onChange: (stats: Record<string, unknown>) => void;
}) {
  const v = stats[statsKey];
  const value = typeof v === "number" ? v : "";
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => {
          if (e.target.value === "") {
            const next = { ...stats };
            delete next[statsKey];
            onChange(next);
            return;
          }
          onChange(setNum(stats, statsKey, Number(e.target.value)));
        }}
      />
    </label>
  );
}

function OptionalTextField({
  label,
  stats,
  statsKey,
  onChange,
}: {
  label: string;
  stats: Record<string, unknown>;
  statsKey: string;
  onChange: (stats: Record<string, unknown>) => void;
}) {
  const v = stats[statsKey];
  const value = typeof v === "string" ? v : "";
  return (
    <label>
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => {
          if (e.target.value === "") {
            const next = { ...stats };
            delete next[statsKey];
            onChange(next);
            return;
          }
          onChange({ ...stats, [statsKey]: e.target.value });
        }}
      />
    </label>
  );
}

interface Props {
  behavior: EnemyBehavior;
  stats: Record<string, unknown>;
  onChange: (stats: Record<string, unknown>) => void;
  focusedAbilityIndex: number | null;
  onFocusAbility: (index: number | null) => void;
}

export function StatsPanel({ behavior, stats, onChange, focusedAbilityIndex, onFocusAbility }: Props) {
  const n = (key: string, fallback = 0) => (
    <NumberField label={LABELS[key] ?? key} value={num(stats, key, fallback)} onChange={(v) => onChange(setNum(stats, key, v))} />
  );

  if (behavior === "melee") {
    return (
      <div className="stats-panel">
        {n("maxHp", 50)}
        {n("damage", 10)}
        {n("range", 2)}
        {n("intervalMs", 1200)}
        <OptionalNumberField label="Aggro Range" stats={stats} statsKey="aggroRange" onChange={onChange} />
      </div>
    );
  }

  if (behavior === "caster") {
    return (
      <div className="stats-panel">
        {n("maxHp", 40)}
        {n("damage", 12)}
        {n("range", 10)}
        {n("cooldownMs", 2000)}
        {n("projectileSpeed", 8)}
        {n("castTimeMs", 800)}
        <OptionalNumberField label="Aggro Range" stats={stats} statsKey="aggroRange" onChange={onChange} />
      </div>
    );
  }

  // boss
  const abilities = Array.isArray(stats.specialAbilities) ? (stats.specialAbilities as BossAbilityDef[]) : [];
  return (
    <div className="stats-panel">
      {n("maxHp", 500)}
      {n("meleeDamage", 16)}
      {n("meleeRange", 2.2)}
      {n("meleeIntervalMs", 1400)}
      {n("aoeDamage", 20)}
      {n("aoeRadius", 4)}
      {n("aoeRange", 12)}
      {n("aoeCooldownMs", 6000)}
      {n("aoeCastTimeMs", 1200)}
      {n("aoeProjectileSpeed", 8)}
      <h4>Reinforcement Wave (optional)</h4>
      <OptionalTextField label="Add Enemy Type ID" stats={stats} statsKey="addEnemyTypeId" onChange={onChange} />
      <OptionalNumberField label="Add Interval (ms)" stats={stats} statsKey="addIntervalMs" onChange={onChange} />
      <OptionalNumberField label="Add Count" stats={stats} statsKey="addCount" onChange={onChange} />
      <OptionalNumberField label="Max Concurrent Adds" stats={stats} statsKey="maxConcurrentAdds" onChange={onChange} />
      <h4>Special Abilities</h4>
      <OptionalNumberField label="Special Cooldown (ms)" stats={stats} statsKey="specialCooldownMs" onChange={onChange} />
      <AbilityListEditor
        value={abilities}
        onChange={(next) => onChange({ ...stats, specialAbilities: next.length > 0 ? next : undefined })}
        focusedIndex={focusedAbilityIndex}
        onFocus={onFocusAbility}
      />
    </div>
  );
}

const LABELS: Record<string, string> = {
  maxHp: "Max HP",
  damage: "Damage",
  range: "Range",
  intervalMs: "Attack Interval (ms)",
  cooldownMs: "Cooldown (ms)",
  projectileSpeed: "Projectile Speed",
  castTimeMs: "Cast Time (ms)",
  meleeDamage: "Melee Damage",
  meleeRange: "Melee Range",
  meleeIntervalMs: "Melee Interval (ms)",
  aoeDamage: "AOE Damage",
  aoeRadius: "AOE Radius",
  aoeRange: "AOE Range",
  aoeCooldownMs: "AOE Cooldown (ms)",
  aoeCastTimeMs: "AOE Cast Time (ms)",
  aoeProjectileSpeed: "AOE Projectile Speed",
};
