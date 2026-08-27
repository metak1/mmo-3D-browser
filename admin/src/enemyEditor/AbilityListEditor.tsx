import { BossAbilityDef, EffectShape } from "@mmo/shared";
import { ACTION_KINDS, ActionFields, defaultAction, defaultShape, NumberField, SHAPE_KINDS, ShapeFields } from "../EffectListEditor";

// Editor for a boss's stats.specialAbilities (BossAbilityDef[]) - the enemy-editor equivalent of
// "attach a spell": each card is one ability (id/name/castTimeMs) wrapping exactly one EffectDef,
// reusing EffectListEditor's own shape/action field UI instead of duplicating it, since a boss
// ability's `effect` is the identical composable {shape, actions[]} structure a spell's effects
// entries use.

function defaultAbility(): BossAbilityDef {
  return {
    id: "",
    name: "New Ability",
    castTimeMs: 1000,
    effect: { shape: defaultShape("circle"), actions: [defaultAction("damage")] },
  };
}

interface Props {
  value: BossAbilityDef[];
  onChange: (value: BossAbilityDef[]) => void;
  focusedIndex: number | null;
  onFocus: (index: number | null) => void;
}

export function AbilityListEditor({ value, onChange, focusedIndex, onFocus }: Props) {
  function updateAbility(index: number, next: BossAbilityDef) {
    onChange(value.map((a, i) => (i === index ? next : a)));
  }
  function removeAbility(index: number) {
    onChange(value.filter((_, i) => i !== index));
    if (focusedIndex === index) onFocus(null);
  }
  function addAbility() {
    onChange([...value, defaultAbility()]);
    onFocus(value.length);
  }

  return (
    <div className="effect-list">
      {value.map((ability, index) => (
        <div
          className={index === focusedIndex ? "effect-card ability-card ability-card-focused" : "effect-card ability-card"}
          key={index}
          onClick={() => onFocus(index)}
        >
          <div className="effect-card-header">
            <span>Ability {index + 1} (click to preview)</span>
            <button
              type="button"
              className="effect-list-remove"
              onClick={(e) => {
                e.stopPropagation();
                removeAbility(index);
              }}
            >
              Remove Ability
            </button>
          </div>

          <div className="effect-field-row">
            <label>
              ID
              <input type="text" value={ability.id} onChange={(e) => updateAbility(index, { ...ability, id: e.target.value })} />
            </label>
            <label>
              Name
              <input type="text" value={ability.name} onChange={(e) => updateAbility(index, { ...ability, name: e.target.value })} />
            </label>
            <NumberField
              label="Cast Time (ms)"
              value={ability.castTimeMs}
              onChange={(castTimeMs) => updateAbility(index, { ...ability, castTimeMs })}
            />
          </div>

          <div className="effect-field-row">
            <label>
              Shape
              <select
                value={ability.effect.shape.kind}
                onChange={(e) =>
                  updateAbility(index, {
                    ...ability,
                    effect: { ...ability.effect, shape: defaultShape(e.target.value as EffectShape["kind"]) },
                  })
                }
              >
                {SHAPE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <ShapeFields
              shape={ability.effect.shape}
              onChange={(shape) => updateAbility(index, { ...ability, effect: { ...ability.effect, shape } })}
            />
          </div>

          <div className="action-list">
            {ability.effect.actions.map((action, actionIndex) => (
              <div className="action-card" key={actionIndex}>
                <label>
                  Action
                  <select
                    value={action.kind}
                    onChange={(e) => {
                      const nextActions = ability.effect.actions.map((a, i) =>
                        i === actionIndex ? defaultAction(e.target.value as typeof action.kind) : a,
                      );
                      updateAbility(index, { ...ability, effect: { ...ability.effect, actions: nextActions } });
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
                    const nextActions = ability.effect.actions.map((a, i) => (i === actionIndex ? nextAction : a));
                    updateAbility(index, { ...ability, effect: { ...ability.effect, actions: nextActions } });
                  }}
                />
                <button
                  type="button"
                  className="effect-list-remove"
                  disabled={ability.effect.actions.length <= 1}
                  title={ability.effect.actions.length <= 1 ? "An ability needs at least one action" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextActions = ability.effect.actions.filter((_, i) => i !== actionIndex);
                    updateAbility(index, { ...ability, effect: { ...ability.effect, actions: nextActions } });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="effect-list-add"
              onClick={(e) => {
                e.stopPropagation();
                updateAbility(index, { ...ability, effect: { ...ability.effect, actions: [...ability.effect.actions, defaultAction("damage")] } });
              }}
            >
              + Add Action
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="effect-list-add" onClick={addAbility}>
        + Add Ability
      </button>
    </div>
  );
}
