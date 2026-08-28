import { FormEvent, useEffect, useState } from "react";
import { EffectDef } from "@mmo/shared";
import { EntitySchema, FieldSchema } from "./entities";
import { listEntities } from "./api";
import { EffectListEditor } from "./EffectListEditor";
import { IngredientListEditor } from "./IngredientListEditor";

type RowData = Record<string, unknown>;

interface Props {
  schema: EntitySchema;
  initial?: RowData; // undefined = creating new
  defaultValues?: RowData; // create-mode only: seeds field values (e.g. from a "+" in a tree view) without switching to edit mode
  onSubmit: (data: RowData) => void | Promise<void>;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}

export function EntityForm({ schema, initial, defaultValues, onSubmit, onCancel, submitting, error }: Props) {
  const [values, setValues] = useState<RowData>(() => initial ?? defaultValues ?? {});
  const [referenceOptions, setReferenceOptions] = useState<Record<string, RowData[]>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const isEditing = initial !== undefined;

  // Every "reference"/"multiselect" field needs the target entity's current list for its
  // dropdown/checklist - fetched once per form open, not on every keystroke.
  useEffect(() => {
    const refEntities = [...new Set(schema.fields.filter((f) => f.referenceEntity).map((f) => f.referenceEntity!))];
    refEntities.forEach((entityKey) => {
      listEntities<RowData>(entityKey).then((res) => {
        setReferenceOptions((prev) => ({ ...prev, [entityKey]: res.items }));
      });
    });
  }, [schema]);

  function setField(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleJsonChange(key: string, text: string) {
    try {
      setField(key, text.trim() === "" ? undefined : JSON.parse(text));
      setJsonErrors((prev) => ({ ...prev, [key]: "" }));
    } catch {
      setJsonErrors((prev) => ({ ...prev, [key]: "Invalid JSON" }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(jsonErrors).some(Boolean)) return;
    onSubmit(values);
  }

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      {schema.fields.map((field) => (
        <div className="form-row" key={field.key}>
          <label>
            {field.label}
            {field.optional ? "" : " *"}
          </label>
          {field.key === "id" && isEditing ? (
            <input type="text" value={String(values.id ?? "")} disabled />
          ) : (
            renderField(field, values[field.key], (v) => setField(field.key, v), referenceOptions, handleJsonChange)
          )}
          {jsonErrors[field.key] && <span className="field-error">{jsonErrors[field.key]}</span>}
        </div>
      ))}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : isEditing ? "Save" : "Create"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function renderField(
  field: FieldSchema,
  value: unknown,
  setValue: (v: unknown) => void,
  referenceOptions: Record<string, RowData[]>,
  handleJsonChange: (key: string, text: string) => void,
) {
  switch (field.type) {
    case "text":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
          required={!field.optional}
        />
      );
    case "textarea":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
          required={!field.optional}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => setValue(e.target.value === "" ? undefined : Number(e.target.value))}
          required={!field.optional}
        />
      );
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} />;
    case "select":
      if (field.numberOptions) {
        return (
          <select
            value={typeof value === "number" ? String(value) : ""}
            onChange={(e) => setValue(e.target.value === "" ? undefined : Number(e.target.value))}
            required={!field.optional}
          >
            <option value="" disabled>
              Select…
            </option>
            {field.numberOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
      }
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
          required={!field.optional}
        >
          <option value="" disabled>
            Select…
          </option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "reference": {
      const options = referenceOptions[field.referenceEntity!] ?? [];
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value || undefined)}
          required={!field.optional}
        >
          <option value="">{field.optional ? "(none)" : "Select…"}</option>
          {options.map((opt) => (
            <option key={String(opt.id)} value={String(opt.id)}>
              {String(opt.id)} — {String(opt.name ?? opt.id)}
            </option>
          ))}
        </select>
      );
    }
    case "multiselect": {
      const options = referenceOptions[field.referenceEntity!] ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="multiselect">
          {options.map((opt) => {
            const id = String(opt.id);
            const checked = selected.includes(id);
            return (
              <label key={id} className="multiselect-option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) setValue([...selected, id]);
                    else setValue(selected.filter((s) => s !== id));
                  }}
                />
                {id} — {String(opt.name ?? id)}
              </label>
            );
          })}
        </div>
      );
    }
    case "json":
      return (
        <textarea
          className="json-field"
          defaultValue={value !== undefined ? JSON.stringify(value, null, 2) : ""}
          onChange={(e) => handleJsonChange(field.key, e.target.value)}
        />
      );
    case "effectList":
      return (
        <EffectListEditor
          value={Array.isArray(value) ? (value as EffectDef[]) : []}
          onChange={(next) => setValue(next.length > 0 ? next : undefined)}
        />
      );
    case "itemQuantityList":
      return (
        <IngredientListEditor
          value={Array.isArray(value) ? (value as { itemId: string; quantity: number }[]) : []}
          onChange={(next) => setValue(next)}
          options={referenceOptions[field.referenceEntity!] ?? []}
        />
      );
  }
}
