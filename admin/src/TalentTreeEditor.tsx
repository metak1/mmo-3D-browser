import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EntitySchema } from "./entities";
import { createEntity, deleteEntity, listEntities, updateEntity } from "./api";
import { EntityForm } from "./EntityForm";

type RowData = Record<string, unknown>;

interface ClassRow {
  id: string;
  name: string;
}

type TalentRow = RowData & {
  id: string;
  class_id: string;
  name: string;
  tier: number;
  column_index: number;
  prerequisite_talent_id: string | null;
};

interface TreeLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 64;

// A visual mirror of the game client's own talent tree (client/src/main.ts's renderTalents):
// nodes grid-positioned by tier/column_index, with SVG lines connecting each node to its
// prerequisite, measured off the actual rendered boxes rather than hand-computed pixel math.
// Replaces the generic EntityTable for the "talents" entity specifically - editing/deleting a
// node still goes through the same EntityForm the table used, so every raw field (including the
// effect JSON) stays reachable; the tree just adds a faster, structural way to browse and extend
// a class's talents plus a couple of shortcuts (root/child "+") for spawning new nodes already
// wired to the right class/tier/column/prerequisite.
export function TalentTreeEditor({ schema }: { schema: EntitySchema }) {
  const [items, setItems] = useState<TalentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined = form closed, null = creating new, a row = editing that row
  const [editing, setEditing] = useState<RowData | null | undefined>(undefined);
  const [createDefaults, setCreateDefaults] = useState<RowData | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [lines, setLines] = useState<TreeLine[]>([]);
  const treeRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([listEntities<TalentRow>(schema.key), listEntities<ClassRow>("classes")])
      .then(([talentsRes, classesRes]) => {
        setItems(talentsRes.items);
        setClasses(classesRes.items);
        setActiveClassId((prev) => prev ?? classesRes.items[0]?.id ?? null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [schema.key]);

  useEffect(() => {
    setEditing(undefined);
    reload();
  }, [reload]);

  const classItems = useMemo(() => items.filter((t) => t.class_id === activeClassId), [items, activeClassId]);

  useEffect(() => {
    const container = treeRef.current;
    if (!container) {
      setLines([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const next: TreeLine[] = [];
    for (const t of classItems) {
      if (!t.prerequisite_talent_id) continue;
      const parentEl = container.querySelector<HTMLElement>(`[data-node-id="${t.prerequisite_talent_id}"]`);
      const childEl = container.querySelector<HTMLElement>(`[data-node-id="${t.id}"]`);
      if (!parentEl || !childEl) continue;
      const p = parentEl.getBoundingClientRect();
      const c = childEl.getBoundingClientRect();
      next.push({
        key: t.id,
        x1: p.left + p.width / 2 - containerRect.left,
        y1: p.bottom - containerRect.top,
        x2: c.left + c.width / 2 - containerRect.left,
        y2: c.top - containerRect.top,
      });
    }
    setLines(next);
  }, [classItems]);

  async function handleSubmit(data: RowData) {
    setSubmitting(true);
    setFormError(null);
    try {
      if (editing) {
        const { id: _id, ...rest } = data;
        await updateEntity(schema.key, String(editing.id), rest);
      } else {
        await createEntity(schema.key, data);
      }
      setEditing(undefined);
      setCreateDefaults(undefined);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: TalentRow) {
    if (!confirm(`Delete "${row.name}"?`)) return;
    setRowError(null);
    try {
      await deleteEntity(schema.key, row.id);
      reload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function openCreate(defaults: RowData) {
    setCreateDefaults(defaults);
    setEditing(null);
  }

  function addRootTalent() {
    if (!activeClassId) return;
    const nextColumn = classItems.filter((t) => t.tier === 1).length;
    openCreate({
      class_id: activeClassId,
      tier: 1,
      column_index: nextColumn,
      max_rank: 12,
      effects: [{ kind: "statBonus", stat: "damagePercent", perRank: 1 }],
    });
  }

  function addChildTalent(parent: TalentRow) {
    openCreate({
      class_id: parent.class_id,
      tier: parent.tier + 1,
      column_index: parent.column_index,
      prerequisite_talent_id: parent.id,
      max_rank: 1,
      effects: [{ kind: "statBonus", stat: "damagePercent", perRank: 1 }],
    });
  }

  const maxTier = Math.max(1, ...classItems.map((t) => t.tier));
  const maxColumn = Math.max(2, ...classItems.map((t) => t.column_index));

  return (
    <div className="entity-table">
      <div className="entity-table-header">
        <h2>{schema.label}</h2>
        <button onClick={() => openCreate({})}>+ New</button>
      </div>

      {rowError && <div className="form-error">{rowError}</div>}

      {editing !== undefined ? (
        <EntityForm
          schema={schema}
          initial={editing ?? undefined}
          defaultValues={createDefaults}
          onSubmit={handleSubmit}
          onCancel={() => {
            setEditing(undefined);
            setCreateDefaults(undefined);
          }}
          submitting={submitting}
          error={formError}
        />
      ) : loading ? (
        <p>Loading…</p>
      ) : loadError ? (
        <p className="form-error">{loadError}</p>
      ) : (
        <>
          <div className="talent-tree-tabs">
            {classes.map((c) => (
              <button
                key={c.id}
                className={c.id === activeClassId ? "nav-item active" : "nav-item"}
                onClick={() => setActiveClassId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div
            className="admin-talent-tree"
            ref={treeRef}
            style={{ gridTemplateColumns: `repeat(${maxColumn + 1}, ${NODE_WIDTH}px)`, gridAutoRows: `${NODE_HEIGHT}px` }}
          >
            <svg className="admin-talent-tree-lines">
              {lines.map((l) => (
                <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              ))}
            </svg>
            {classItems.length === 0 && <p className="admin-talent-tree-empty">No talents for this class yet.</p>}
            {classItems.map((t) => (
              <div
                key={t.id}
                data-node-id={t.id}
                className="admin-talent-node"
                style={{ gridRow: t.tier, gridColumn: t.column_index + 1 }}
              >
                <button className="admin-talent-node-body" onClick={() => setEditing(t)} title="Edit">
                  <span className="admin-talent-node-name">{t.name}</span>
                  <span className="admin-talent-node-id">{t.id}</span>
                </button>
                <button className="admin-talent-node-add" title={`Add a talent under ${t.name}`} onClick={() => addChildTalent(t)}>
                  +
                </button>
                <button className="admin-talent-node-delete" title="Delete" onClick={() => handleDelete(t)}>
                  ×
                </button>
              </div>
            ))}
          </div>

          <button className="admin-talent-tree-add-root" onClick={addRootTalent} disabled={!activeClassId}>
            + Add root talent
          </button>
        </>
      )}
    </div>
  );
}
