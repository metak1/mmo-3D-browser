import { useCallback, useEffect, useState } from "react";
import { EntitySchema } from "./entities";
import { activateEntity, createEntity, deleteEntity, listEntities, updateEntity } from "./api";
import { EntityForm } from "./EntityForm";

type RowData = Record<string, unknown>;

export function EntityTable({ schema }: { schema: EntitySchema }) {
  const [items, setItems] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined = form closed, null = creating new, a row = editing that row
  const [editing, setEditing] = useState<RowData | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listEntities<RowData>(schema.key)
      .then((res) => {
        setItems(res.items);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [schema.key]);

  useEffect(() => {
    setEditing(undefined);
    reload();
  }, [reload]);

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
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: RowData) {
    if (!confirm(`Delete "${row[schema.displayField] ?? row.id}"?`)) return;
    setRowError(null);
    try {
      await deleteEntity(schema.key, String(row.id));
      reload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleActivate(row: RowData) {
    setRowError(null);
    try {
      await activateEntity(schema.key, String(row.id));
      reload();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Activate failed");
    }
  }

  return (
    <div className="entity-table">
      <div className="entity-table-header">
        <h2>{schema.label}</h2>
        <button onClick={() => setEditing(null)}>+ New</button>
      </div>

      {rowError && <div className="form-error">{rowError}</div>}

      {editing !== undefined ? (
        <EntityForm
          schema={schema}
          initial={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(undefined)}
          submitting={submitting}
          error={formError}
        />
      ) : loading ? (
        <p>Loading…</p>
      ) : loadError ? (
        <p className="form-error">{loadError}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              {schema.displayField !== "id" && <th>{schema.label.replace(/s$/, "")}</th>}
              {schema.hasActivate && <th>Active</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id)}</td>
                {schema.displayField !== "id" && <td>{String(row[schema.displayField] ?? "")}</td>}
                {schema.hasActivate && (
                  <td>
                    {row.is_active ? (
                      <span className="active-badge">Active</span>
                    ) : (
                      <button onClick={() => handleActivate(row)}>Activate</button>
                    )}
                  </td>
                )}
                <td className="row-actions">
                  <button onClick={() => setEditing(row)}>Edit</button>
                  <button onClick={() => handleDelete(row)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
