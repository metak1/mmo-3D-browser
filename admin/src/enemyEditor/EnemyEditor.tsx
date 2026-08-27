import { useEffect, useRef, useState } from "react";
import { EnemyBehavior } from "@mmo/shared";
import { createEntity, deleteEntity, getEntity, listEntities, updateEntity } from "../api";
import { EnemyPreviewScene, MODEL_OPTIONS } from "./EnemyPreviewScene";
import { StatsPanel } from "./StatsPanel";

// Custom view for the "enemy-types" entity, replacing the generic EntityTable/EntityForm flow
// (same precedent as TalentTreeEditor for "talents" - see App.tsx) with a live 3D preview, a
// model picker, a typed stats panel, and (for bosses) an ability builder whose telegraph shape
// previews live on the model.

interface EnemyTypeRow {
  id: string;
  name: string;
  behavior: EnemyBehavior;
  xp_reward: number;
  gold_reward: number;
  stats: Record<string, unknown>;
  model_id: string | null;
}

const DEFAULT_STATS: Record<EnemyBehavior, Record<string, unknown>> = {
  melee: { maxHp: 50, damage: 10, range: 2, intervalMs: 1200 },
  caster: { maxHp: 40, damage: 12, range: 10, cooldownMs: 2000, projectileSpeed: 8, castTimeMs: 800 },
  boss: {
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
};

function emptyForm(): EnemyTypeRow {
  return { id: "", name: "", behavior: "melee", xp_reward: 10, gold_reward: 5, stats: { ...DEFAULT_STATS.melee }, model_id: null };
}

export function EnemyEditor() {
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined = nothing selected, otherwise the row currently being created/edited
  const [form, setForm] = useState<EnemyTypeRow | undefined>(undefined);
  const [isNew, setIsNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusedAbilityIndex, setFocusedAbilityIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<EnemyPreviewScene | null>(null);

  function reload() {
    listEntities<EnemyTypeRow>("enemy-types")
      .then((res) => {
        setItems(res.items.map((r) => ({ id: r.id, name: r.name })));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }

  useEffect(reload, []);

  // Mount the 3D viewport once and keep it alive across selection changes - only the model/
  // telegraph inside it swap, not the scene/camera/renderer themselves.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new EnemyPreviewScene();
    sceneRef.current = scene;
    scene.mount(container);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!form) return;
    sceneRef.current?.setModel(form.model_id ?? undefined);
  }, [form?.model_id]);

  useEffect(() => {
    if (!form || form.behavior !== "boss" || focusedAbilityIndex === null) {
      sceneRef.current?.previewTelegraph(null);
      return;
    }
    const abilities = Array.isArray(form.stats.specialAbilities) ? (form.stats.specialAbilities as { effect?: { shape?: unknown } }[]) : [];
    const shape = abilities[focusedAbilityIndex]?.effect?.shape;
    sceneRef.current?.previewTelegraph((shape as Parameters<EnemyPreviewScene["previewTelegraph"]>[0]) ?? null);
  }, [form?.stats.specialAbilities, focusedAbilityIndex, form?.behavior]);

  function selectNew() {
    setIsNew(true);
    setFormError(null);
    setFocusedAbilityIndex(null);
    setForm(emptyForm());
  }

  async function select(id: string) {
    setFormError(null);
    setFocusedAbilityIndex(null);
    try {
      const res = await getEntity<EnemyTypeRow>("enemy-types", id);
      setIsNew(false);
      setForm(res.item);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  function setBehavior(behavior: EnemyBehavior) {
    setForm((prev) => (prev ? { ...prev, behavior, stats: { ...DEFAULT_STATS[behavior], ...prev.stats } } : prev));
  }

  async function handleSave() {
    if (!form) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name,
        behavior: form.behavior,
        xp_reward: form.xp_reward,
        gold_reward: form.gold_reward,
        stats: form.stats,
        model_id: form.model_id,
      };
      if (isNew) {
        await createEntity("enemy-types", { id: form.id, ...payload });
      } else {
        await updateEntity("enemy-types", form.id, payload);
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
      await deleteEntity("enemy-types", form.id);
      setForm(undefined);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="enemy-editor">
      <div className="enemy-editor-list">
        <div className="entity-table-header">
          <h2>Enemy Types</h2>
          <button onClick={selectNew}>+ New</button>
        </div>
        {loadError && <p className="form-error">{loadError}</p>}
        <ul className="enemy-editor-rows">
          {items.map((row) => (
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

      <div className="enemy-editor-viewport" ref={containerRef} />

      <div className="enemy-editor-panel">
        {!form ? (
          <p>Select an enemy type to edit, or create a new one.</p>
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
                Name
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Behavior
                <select value={form.behavior} onChange={(e) => setBehavior(e.target.value as EnemyBehavior)}>
                  <option value="melee">melee</option>
                  <option value="caster">caster</option>
                  <option value="boss">boss</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                XP Reward
                <input
                  type="number"
                  value={form.xp_reward}
                  onChange={(e) => setForm({ ...form, xp_reward: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Gold Reward
                <input
                  type="number"
                  value={form.gold_reward}
                  onChange={(e) => setForm({ ...form, gold_reward: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Model (blank = default goblin)
                <select
                  value={form.model_id ?? ""}
                  onChange={(e) => setForm({ ...form, model_id: e.target.value === "" ? null : e.target.value })}
                >
                  <option value="">(default goblin)</option>
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <StatsPanel
              behavior={form.behavior}
              stats={form.stats}
              onChange={(stats) => setForm({ ...form, stats })}
              focusedAbilityIndex={focusedAbilityIndex}
              onFocusAbility={setFocusedAbilityIndex}
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
