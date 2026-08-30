import { AilmentKind, BuffKind, EffectAction, EffectDef, EffectShape } from "@mmo/shared";

// The composable effect system's own admin form (see shared/src/types.ts's EffectDef doc comment
// and CombatEngine's resolveEffect, the interpreter this data ultimately drives) - the first
// repeatable array-of-typed-objects editor in the admin (every other list-shaped field is either
// a `multiselect` checklist against a whole other entity, or a raw `json` textarea). Each effect
// card is one shape + a freely combinable list of actions; both dropdowns switch which fields
// render below them, so an admin picks kinds and fills in numbers instead of hand-writing JSON
// matching an internal TypeScript union from memory.

export const SHAPE_KINDS: EffectShape["kind"][] = ["singleTarget", "circle", "cone", "line", "randomPoints"];
export const ACTION_KINDS: EffectAction["kind"][] = ["damage", "heal", "dot", "ailment", "buff", "knockback", "dispel", "interrupt", "summon", "resetCooldown"];
export const AILMENT_KINDS: AilmentKind[] = ["weaken"];
export const BUFF_KINDS: BuffKind[] = ["battleFury", "shadowStep", "huntersFocus", "divineFavor", "arcaneSurge"];

export function defaultShape(kind: EffectShape["kind"]): EffectShape {
  switch (kind) {
    case "singleTarget":
      return { kind };
    case "circle":
      return { kind, radius: 5, centeredOn: "impact" };
    case "cone":
      return { kind, radius: 5, angleDeg: 60 };
    case "line":
      return { kind, length: 6, width: 2 };
    case "randomPoints":
      return { kind, count: 3, spreadRadius: 5, pointRadius: 2 };
  }
}

export function defaultAction(kind: EffectAction["kind"]): EffectAction {
  switch (kind) {
    case "damage":
      return { kind, amount: 10 };
    case "heal":
      return { kind, amount: 10 };
    case "dot":
      return { kind, amount: 5, tickIntervalMs: 1000, durationMs: 5000 };
    case "ailment":
      return { kind, ailment: "weaken" };
    case "buff":
      return { kind, buff: "battleFury" };
    case "knockback":
      return { kind, distance: 3 };
    case "dispel":
      return { kind };
    case "interrupt":
      return { kind };
    case "summon":
      return { kind, enemyTypeId: "", count: 1 };
    case "resetCooldown":
      return { kind, spellId: "" };
  }
}

export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function ShapeFields({ shape, onChange }: { shape: EffectShape; onChange: (s: EffectShape) => void }) {
  if (shape.kind === "singleTarget") return null;
  if (shape.kind === "circle") {
    return (
      <>
        <NumberField label="Radius" value={shape.radius} onChange={(radius) => onChange({ ...shape, radius })} />
        <label>
          Centered On
          <select value={shape.centeredOn} onChange={(e) => onChange({ ...shape, centeredOn: e.target.value as "caster" | "impact" })}>
            <option value="caster">Caster</option>
            <option value="impact">Impact Point</option>
          </select>
        </label>
      </>
    );
  }
  if (shape.kind === "cone") {
    return (
      <>
        <NumberField label="Radius" value={shape.radius} onChange={(radius) => onChange({ ...shape, radius })} />
        <NumberField label="Angle (deg)" value={shape.angleDeg} onChange={(angleDeg) => onChange({ ...shape, angleDeg })} />
      </>
    );
  }
  if (shape.kind === "line") {
    return (
      <>
        <NumberField label="Length" value={shape.length} onChange={(length) => onChange({ ...shape, length })} />
        <NumberField label="Width" value={shape.width} onChange={(width) => onChange({ ...shape, width })} />
      </>
    );
  }
  // randomPoints
  return (
    <>
      <NumberField label="Count" value={shape.count} onChange={(count) => onChange({ ...shape, count })} />
      <NumberField label="Spread Radius" value={shape.spreadRadius} onChange={(spreadRadius) => onChange({ ...shape, spreadRadius })} />
      <NumberField label="Point Radius" value={shape.pointRadius} onChange={(pointRadius) => onChange({ ...shape, pointRadius })} />
    </>
  );
}

export function ActionFields({ action, onChange }: { action: EffectAction; onChange: (a: EffectAction) => void }) {
  switch (action.kind) {
    case "damage":
    case "heal":
      return <NumberField label="Amount" value={action.amount} onChange={(amount) => onChange({ ...action, amount })} />;
    case "dot":
      return (
        <>
          <NumberField label="Amount/Tick" value={action.amount} onChange={(amount) => onChange({ ...action, amount })} />
          <NumberField label="Tick Interval (ms)" value={action.tickIntervalMs} onChange={(tickIntervalMs) => onChange({ ...action, tickIntervalMs })} />
          <NumberField label="Duration (ms)" value={action.durationMs} onChange={(durationMs) => onChange({ ...action, durationMs })} />
        </>
      );
    case "ailment":
      return (
        <label>
          Ailment
          <select value={action.ailment} onChange={(e) => onChange({ ...action, ailment: e.target.value as AilmentKind })}>
            {AILMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      );
    case "buff":
      return (
        <label>
          Buff
          <select value={action.buff} onChange={(e) => onChange({ ...action, buff: e.target.value as BuffKind })}>
            {BUFF_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      );
    case "knockback":
      return <NumberField label="Distance" value={action.distance} onChange={(distance) => onChange({ ...action, distance })} />;
    case "dispel":
    case "interrupt":
      return null;
    case "summon":
      return (
        <>
          <label>
            Enemy Type ID
            <input type="text" value={action.enemyTypeId} onChange={(e) => onChange({ ...action, enemyTypeId: e.target.value })} />
          </label>
          <NumberField label="Count" value={action.count} onChange={(count) => onChange({ ...action, count })} />
        </>
      );
    case "resetCooldown":
      return (
        <label>
          Spell ID
          <input type="text" value={action.spellId} onChange={(e) => onChange({ ...action, spellId: e.target.value })} />
        </label>
      );
  }
}

interface Props {
  value: EffectDef[];
  onChange: (value: EffectDef[]) => void;
  // Optional click-to-preview wiring (see SpellEditor.tsx/AbilityListEditor.tsx, which drives a
  // live 3D telegraph from whichever card is focused) - omitted entirely by callers that don't
  // preview anything (items.use_effects, via the generic EntityForm), so a card is neither
  // clickable nor highlighted unless both are provided.
  focusedIndex?: number | null;
  onFocus?: (index: number | null) => void;
}

export function EffectListEditor({ value, onChange, focusedIndex, onFocus }: Props) {
  function updateEffect(index: number, next: EffectDef) {
    onChange(value.map((e, i) => (i === index ? next : e)));
  }
  function removeEffect(index: number) {
    onChange(value.filter((_, i) => i !== index));
    if (onFocus && focusedIndex === index) onFocus(null);
  }
  function addEffect() {
    onChange([...value, { shape: defaultShape("circle"), actions: [defaultAction("damage")] }]);
  }

  return (
    <div className="effect-list">
      {value.map((effect, effectIndex) => (
        <div
          className={onFocus && effectIndex === focusedIndex ? "effect-card ability-card ability-card-focused" : onFocus ? "effect-card ability-card" : "effect-card"}
          key={effectIndex}
          onClick={onFocus ? () => onFocus(effectIndex) : undefined}
        >
          <div className="effect-card-header">
            <span>Effect {effectIndex + 1}</span>
            <button
              type="button"
              className="effect-list-remove"
              onClick={(e) => {
                e.stopPropagation();
                removeEffect(effectIndex);
              }}
            >
              Remove Effect
            </button>
          </div>

          <div className="effect-field-row">
            <label>
              Shape
              <select
                value={effect.shape.kind}
                onChange={(e) => updateEffect(effectIndex, { ...effect, shape: defaultShape(e.target.value as EffectShape["kind"]) })}
              >
                {SHAPE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <ShapeFields shape={effect.shape} onChange={(shape) => updateEffect(effectIndex, { ...effect, shape })} />
          </div>

          <div className="action-list">
            {effect.actions.map((action, actionIndex) => (
              <div className="action-card" key={actionIndex}>
                <label>
                  Action
                  <select
                    value={action.kind}
                    onChange={(e) => {
                      const nextActions = effect.actions.map((a, i) => (i === actionIndex ? defaultAction(e.target.value as EffectAction["kind"]) : a));
                      updateEffect(effectIndex, { ...effect, actions: nextActions });
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
                    updateEffect(effectIndex, { ...effect, actions: nextActions });
                  }}
                />
                <button
                  type="button"
                  className="effect-list-remove"
                  disabled={effect.actions.length <= 1}
                  title={effect.actions.length <= 1 ? "An effect needs at least one action" : undefined}
                  onClick={() => updateEffect(effectIndex, { ...effect, actions: effect.actions.filter((_, i) => i !== actionIndex) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="effect-list-add"
              onClick={() => updateEffect(effectIndex, { ...effect, actions: [...effect.actions, defaultAction("damage")] })}
            >
              + Add Action
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="effect-list-add" onClick={addEffect}>
        + Add Effect
      </button>
    </div>
  );
}
