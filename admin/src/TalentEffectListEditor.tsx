import { BuffKind, EffectDef, TalentEffect, TalentStatKey } from "@mmo/shared";
import { ACTION_KINDS, ActionFields, BUFF_KINDS, NumberField, SHAPE_KINDS, ShapeFields, defaultAction, defaultShape } from "./EffectListEditor";

// TalentDef.effects' own typed editor, replacing what used to be a raw JSON textarea (see
// EffectListEditor.tsx's own doc comment for why that mattered for spells/items). Four of the five
// TalentEffect kinds are flat scalar fields; the fifth, "onCastEffect", nests a full composable
// EffectDef (the same {shape, actions[]} shape spells/boss abilities use) resolved against the
// triggering spell's own target - so its sub-form reuses EffectListEditor's own exported
// Shape/Action helpers instead of duplicating them, the same reuse AbilityListEditor.tsx already
// established for boss abilities.

export const TALENT_EFFECT_KINDS: TalentEffect["kind"][] = ["statBonus", "spellStatBonus", "extraCharges", "onCastBuff", "onCastEffect"];
export const TALENT_STAT_KINDS: TalentStatKey[] = ["damagePercent", "critChanceBonus", "cooldownPercent", "armorBonus", "maxHpPercent"];

export function defaultTalentEffect(kind: TalentEffect["kind"]): TalentEffect {
  switch (kind) {
    case "statBonus":
      return { kind, stat: "damagePercent", perRank: 1 };
    case "spellStatBonus":
      return { kind, spellId: "", stat: "damagePercent", perRank: 1 };
    case "extraCharges":
      return { kind, spellId: "", perRank: 1 };
    case "onCastBuff":
      return { kind, spellId: "", buffId: "battleFury" };
    case "onCastEffect":
      return { kind, spellId: "", effect: { shape: defaultShape("singleTarget"), actions: [defaultAction("damage")] } };
  }
}

function StatSelect({ value, onChange }: { value: TalentStatKey; onChange: (stat: TalentStatKey) => void }) {
  return (
    <label>
      Stat
      <select value={value} onChange={(e) => onChange(e.target.value as TalentStatKey)}>
        {TALENT_STAT_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </label>
  );
}

function SpellIdField({ value, onChange }: { value: string; onChange: (spellId: string) => void }) {
  return (
    <label>
      Spell ID
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TalentEffectFields({ effect, onChange }: { effect: TalentEffect; onChange: (e: TalentEffect) => void }) {
  switch (effect.kind) {
    case "statBonus":
      return (
        <>
          <StatSelect value={effect.stat} onChange={(stat) => onChange({ ...effect, stat })} />
          <NumberField label="Per Rank" value={effect.perRank} onChange={(perRank) => onChange({ ...effect, perRank })} />
        </>
      );
    case "spellStatBonus":
      return (
        <>
          <SpellIdField value={effect.spellId} onChange={(spellId) => onChange({ ...effect, spellId })} />
          <StatSelect value={effect.stat} onChange={(stat) => onChange({ ...effect, stat })} />
          <NumberField label="Per Rank" value={effect.perRank} onChange={(perRank) => onChange({ ...effect, perRank })} />
        </>
      );
    case "extraCharges":
      return (
        <>
          <SpellIdField value={effect.spellId} onChange={(spellId) => onChange({ ...effect, spellId })} />
          <NumberField label="Per Rank" value={effect.perRank} onChange={(perRank) => onChange({ ...effect, perRank })} />
        </>
      );
    case "onCastBuff":
      return (
        <>
          <SpellIdField value={effect.spellId} onChange={(spellId) => onChange({ ...effect, spellId })} />
          <label>
            Buff
            <select value={effect.buffId} onChange={(e) => onChange({ ...effect, buffId: e.target.value as BuffKind })}>
              {BUFF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </>
      );
    case "onCastEffect":
      return (
        <>
          <SpellIdField value={effect.spellId} onChange={(spellId) => onChange({ ...effect, spellId })} />
          <OnCastEffectDefFields effect={effect.effect} onChange={(nextEffect) => onChange({ ...effect, effect: nextEffect })} />
        </>
      );
  }
}

// A single-effect version of EffectListEditor's per-card body (shape dropdown + its fields, then
// a combinable action list) - not the whole list editor, since a talent's onCastEffect nests
// exactly one EffectDef, not an array of them.
function OnCastEffectDefFields({ effect, onChange }: { effect: EffectDef; onChange: (e: EffectDef) => void }) {
  return (
    <div className="effect-card">
      <div className="effect-field-row">
        <label>
          Shape
          <select
            value={effect.shape.kind}
            onChange={(e) => onChange({ ...effect, shape: defaultShape(e.target.value as (typeof SHAPE_KINDS)[number]) })}
          >
            {SHAPE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <ShapeFields shape={effect.shape} onChange={(shape) => onChange({ ...effect, shape })} />
      </div>
      <div className="action-list">
        {effect.actions.map((action, actionIndex) => (
          <div className="action-card" key={actionIndex}>
            <label>
              Action
              <select
                value={action.kind}
                onChange={(e) => {
                  const nextActions = effect.actions.map((a, i) => (i === actionIndex ? defaultAction(e.target.value as (typeof ACTION_KINDS)[number]) : a));
                  onChange({ ...effect, actions: nextActions });
                }}
              >
                {ACTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <ActionFields
              action={action}
              onChange={(nextAction) => {
                const nextActions = effect.actions.map((a, i) => (i === actionIndex ? nextAction : a));
                onChange({ ...effect, actions: nextActions });
              }}
            />
            <button
              type="button"
              className="effect-list-remove"
              disabled={effect.actions.length <= 1}
              title={effect.actions.length <= 1 ? "An effect needs at least one action" : undefined}
              onClick={() => onChange({ ...effect, actions: effect.actions.filter((_, i) => i !== actionIndex) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="effect-list-add" onClick={() => onChange({ ...effect, actions: [...effect.actions, defaultAction("damage")] })}>
          + Add Action
        </button>
      </div>
    </div>
  );
}

interface Props {
  value: TalentEffect[];
  onChange: (value: TalentEffect[]) => void;
}

export function TalentEffectListEditor({ value, onChange }: Props) {
  function updateEffect(index: number, next: TalentEffect) {
    onChange(value.map((e, i) => (i === index ? next : e)));
  }
  function removeEffect(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addEffect() {
    onChange([...value, defaultTalentEffect("statBonus")]);
  }

  return (
    <div className="effect-list">
      {value.map((effect, index) => (
        <div className="effect-card" key={index}>
          <div className="effect-card-header">
            <span>Effect {index + 1}</span>
            <button
              type="button"
              className="effect-list-remove"
              disabled={value.length <= 1}
              title={value.length <= 1 ? "A talent needs at least one effect" : undefined}
              onClick={() => removeEffect(index)}
            >
              Remove Effect
            </button>
          </div>
          <div className="effect-field-row">
            <label>
              Kind
              <select
                value={effect.kind}
                onChange={(e) => updateEffect(index, defaultTalentEffect(e.target.value as TalentEffect["kind"]))}
              >
                {TALENT_EFFECT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <TalentEffectFields effect={effect} onChange={(next) => updateEffect(index, next)} />
          </div>
        </div>
      ))}
      <button type="button" className="effect-list-add" onClick={addEffect}>
        + Add Effect
      </button>
    </div>
  );
}
