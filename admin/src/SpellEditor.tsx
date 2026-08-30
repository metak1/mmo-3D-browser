import { useEffect, useRef, useState } from "react";
import { EffectDef, SpellTargetType } from "@mmo/shared";
import { createEntity, deleteEntity, getEntity, listEntities, updateEntity } from "./api";
import { EffectListEditor } from "./EffectListEditor";
import { EnemyPreviewScene } from "./enemyEditor/EnemyPreviewScene";

// Custom view for the "spells" entity, replacing the generic EntityTable/EntityForm flow (same
// precedent as EnemyEditor for "enemy-types" - see App.tsx) with a live telegraph preview of
// whichever effect card is focused, driven by the exact same EnemyPreviewScene/Telegraph a boss
// ability's own preview uses - a spell's `effects` is the identical composable {shape, actions[]}
// structure. No model picker here (unlike EnemyEditor): a spell has no model_id of its own, so the
// scene always shows EnemyPreviewScene's own "no specific model" fallback body - see the plan's
// own reasoning for why a class-accurate player model is out of scope for this pass.

interface SpellRow {
  id: string;
  class_id: string;
  name: string;
  description: string;
  target_type: SpellTargetType;
  cooldown_ms: number;
  cast_time_ms: number;
  range: number;
  projectile_speed: number | null;
  effects: EffectDef[];
}

const TARGET_TYPES: SpellTargetType[] = ["enemy", "ally", "self", "ground"];

function emptyForm(classId: string): SpellRow {
  return {
    id: "",
    class_id: classId,
    name: "",
    description: "",
    target_type: "enemy",
    cooldown_ms: 1500,
    cast_time_ms: 0,
    range: 5,
    projectile_speed: null,
    effects: [{ shape: { kind: "singleTarget" }, actions: [{ kind: "damage", amount: 10 }] }],
  };
}

export function SpellEditor() {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<{ id: string; name: string; class_id: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined = nothing selected, otherwise the row currently being created/edited
  const [form, setForm] = useState<SpellRow | undefined>(undefined);
  const [isNew, setIsNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusedEffectIndex, setFocusedEffectIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<EnemyPreviewScene | null>(null);

  function reload() {
    listEntities<SpellRow>("spells")
      .then((res) => {
        setItems(res.items.map((r) => ({ id: r.id, name: r.name, class_id: r.class_id })));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }

  useEffect(reload, []);
  useEffect(() => {
    listEntities<{ id: string; name: string }>("classes").then((res) => setClasses(res.items));
  }, []);

  // Mount the 3D viewport once and keep it alive across selection changes, same as EnemyEditor -
  // only the telegraph inside it changes, never the scene/camera/renderer. No model swap needed:
  // this always shows EnemyPreviewScene's own "no specific model" fallback body.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new EnemyPreviewScene();
    sceneRef.current = scene;
    scene.mount(container);
    scene.setModel(undefined);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!form || focusedEffectIndex === null) {
      sceneRef.current?.previewTelegraph(null);
      return;
    }
    const shape = form.effects[focusedEffectIndex]?.shape;
    sceneRef.current?.previewTelegraph(shape ?? null);
  }, [form?.effects, focusedEffectIndex]);

  function selectNew() {
    setIsNew(true);
    setFormError(null);
    setFocusedEffectIndex(null);
    setForm(emptyForm(classes[0]?.id ?? ""));
  }

  async function select(id: string) {
    setFormError(null);
    setFocusedEffectIndex(null);
    try {
      const res = await getEntity<SpellRow>("spells", id);
      setIsNew(false);
      setForm(res.item);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  async function handleSave() {
    if (!form) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        class_id: form.class_id,
        name: form.name,
        description: form.description,
        target_type: form.target_type,
        cooldown_ms: form.cooldown_ms,
        cast_time_ms: form.cast_time_ms,
        range: form.range,
        projectile_speed: form.projectile_speed,
        effects: form.effects,
      };
      if (isNew) {
        await createEntity("spells", { id: form.id, ...payload });
      } else {
        await updateEntity("spells", form.id, payload);
      }
      reload();
      setIsNew(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!form || isNew) return;
    if (!confirm(`Delete "${form.name}"?`)) return;
    try {
      await deleteEntity("spells", form.id);
      setForm(undefined);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const groups = classes.map((c) => ({ ...c, spells: items.filter((s) => s.class_id === c.id) }));

  return (
    <div className="enemy-editor">
      <div className="enemy-editor-list">
        <div className="entity-table-header">
          <h2>Spells</h2>
          <button onClick={selectNew}>+ New</button>
        </div>
        {loadError && <p className="form-error">{loadError}</p>}
        {groups.map((group) => (
          <div key={group.id}>
            <h4>{group.name}</h4>
            <ul className="enemy-editor-rows">
              {group.spells.map((row) => (
                <li key={row.id}>
                  <button
                    className={form && !isNew && form.id === row.id ? "nav-item active" : "nav-item"}
                    onClick={() => select(row.id)}
                  >
                    {row.name} <span className="enemy-editor-row-id">{row.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="enemy-editor-viewport" ref={containerRef} />

      <div className="enemy-editor-panel">
        {!form ? (
          <p>Select a spell to edit, or create a new one.</p>
        ) : (
          <>
            <div className="form-row">
              <label>
                ID {!isNew && <input type="text" value={form.id} disabled />}
                {isNew && <input type="text" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />}
              </label>
            </div>
            <div className="form-row">
              <label>
                Class
                <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Name
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Target Type
                <select value={form.target_type} onChange={(e) => setForm({ ...form, target_type: e.target.value as SpellTargetType })}>
                  {TARGET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Cooldown (ms)
                <input type="number" value={form.cooldown_ms} onChange={(e) => setForm({ ...form, cooldown_ms: Number(e.target.value) })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Cast Time (ms)
                <input type="number" value={form.cast_time_ms} onChange={(e) => setForm({ ...form, cast_time_ms: Number(e.target.value) })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Range
                <input type="number" value={form.range} onChange={(e) => setForm({ ...form, range: Number(e.target.value) })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Projectile Speed (blank = not a projectile)
                <input
                  type="number"
                  value={form.projectile_speed ?? ""}
                  onChange={(e) => setForm({ ...form, projectile_speed: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </label>
            </div>

            <h4>Effects</h4>
            <EffectListEditor
              value={form.effects}
              onChange={(effects) => setForm({ ...form, effects })}
              focusedIndex={focusedEffectIndex}
              onFocus={setFocusedEffectIndex}
            />

            {formError && <div className="form-error">{formError}</div>}
            <div className="form-actions">
              <button onClick={handleSave} disabled={submitting}>
                {submitting ? "Saving…" : isNew ? "Create" : "Save"}
              </button>
              {!isNew && (
                <button onClick={handleDelete} disabled={submitting}>
                  Delete
                </button>
              )}
              <button onClick={() => setForm(undefined)} disabled={submitting}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
