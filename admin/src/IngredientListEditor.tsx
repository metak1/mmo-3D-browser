// Editor for a recipe's `ingredients: {itemId, quantity}[]` - the first admin list-editor for
// "a list of {reference, quantity} pairs" (multiselect only stores bare id arrays, no per-entry
// quantity - see admin/src/EntityForm.tsx's FieldType doc comment). Much simpler than
// EffectListEditor.tsx's nested shape/action cards since each row is just two fields.

type RowData = Record<string, unknown>;

interface Ingredient {
  itemId: string;
  quantity: number;
}

interface Props {
  value: Ingredient[];
  onChange: (value: Ingredient[]) => void;
  options: RowData[]; // the referenced entity's rows (e.g. items), for the id dropdown
}

export function IngredientListEditor({ value, onChange, options }: Props) {
  function updateRow(index: number, next: Ingredient) {
    onChange(value.map((r, i) => (i === index ? next : r)));
  }
  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...value, { itemId: options[0] ? String(options[0].id) : "", quantity: 1 }]);
  }

  return (
    <div className="effect-list">
      {value.map((row, index) => (
        <div className="action-card" key={index}>
          <label>
            Item
            <select value={row.itemId} onChange={(e) => updateRow(index, { ...row, itemId: e.target.value })}>
              <option value="" disabled>
                Select…
              </option>
              {options.map((opt) => (
                <option key={String(opt.id)} value={String(opt.id)}>
                  {String(opt.id)} — {String(opt.name ?? opt.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              value={row.quantity}
              onChange={(e) => updateRow(index, { ...row, quantity: Number(e.target.value) })}
            />
          </label>
          <button type="button" className="effect-list-remove" onClick={() => removeRow(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="effect-list-add" onClick={addRow}>
        + Add Ingredient
      </button>
    </div>
  );
}
