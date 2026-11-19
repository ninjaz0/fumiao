import "./parameter-fields.css";
import {
  normalizeForm,
  type ModelForm,
  type FormValues,
  type Value,
} from "../../../packages/plugin-sdk/src/model-form";

export function ParameterFields({
  form,
  values,
  change,
}: {
  form: ModelForm;
  values: FormValues;
  change: (v: FormValues) => void;
}) {
  function edit(name: string, value: Value | undefined) {
    const next = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    // Text and number inputs can be temporarily incomplete while typing.
    change(form.fields[name].enum ? normalizeForm(form, next, name) : next);
  }
  return (
    <>
      {Object.entries(form.fields).map(([name, field]) => {
        const label = field.title ?? name,
          value = values[name],
          required = form.required?.includes(name);
        const options =
          field.enum ??
          (field.type === "boolean" && !required ? [true, false] : undefined);
        return (
          <label className="parameter-button model-parameter" key={name}>
            {label}
            {options ? (
              <select
                aria-label={label}
                value={JSON.stringify(value) ?? ""}
                onChange={(e) =>
                  edit(
                    name,
                    e.target.value ? JSON.parse(e.target.value) : undefined,
                  )
                }
              >
                {!required && <option value="">默认</option>}
                {options
                  .filter(
                    (option) =>
                      !form.combinations ||
                      form.combinations.some(
                        (c) => !c[name] || c[name].includes(option),
                      ),
                  )
                  .map((option) => (
                    <option
                      key={JSON.stringify(option)}
                      value={JSON.stringify(option)}
                    >
                      {option === true
                        ? "开"
                        : option === false
                          ? "关"
                          : String(option)}
                    </option>
                  ))}
              </select>
            ) : field.type === "boolean" ? (
              <input
                type="checkbox"
                aria-label={label}
                checked={value === true}
                onChange={(e) => edit(name, e.target.checked)}
              />
            ) : (
              <input
                aria-label={label}
                type={field.type === "string" ? "text" : "number"}
                required={required}
                min={field.minimum}
                max={field.maximum}
                step={field.type === "number" ? "any" : 1}
                minLength={field.minLength}
                maxLength={field.maxLength}
                value={value === undefined ? "" : String(value)}
                onChange={(e) =>
                  edit(
                    name,
                    field.type === "string"
                      ? e.target.value
                      : e.target.value === ""
                        ? undefined
                        : e.target.valueAsNumber,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </>
  );
}
