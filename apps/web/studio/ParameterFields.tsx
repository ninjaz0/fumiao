import "./parameter-fields.css";
import {
  evaluateFormConstraints,
  normalizeForm,
  type ModelForm,
  type FormValues,
  type Value,
} from "@fumiao/plugin-sdk/model-form";

function optionLabel(
  option: Value,
  labels?: Record<string, string>,
): string {
  const custom = labels?.[String(option)];
  if (custom) return custom;
  if (option === true) return "开";
  if (option === false) return "关";
  return String(option);
}

export function ParameterFields({
  form,
  values,
  change,
  keepHistorical = false,
}: {
  form: ModelForm;
  values: FormValues;
  change: (v: FormValues) => void;
  keepHistorical?: boolean;
}) {
  const evaluated = evaluateFormConstraints(form, values);
  function edit(name: string, value: Value | undefined) {
    const next = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    // Text and number inputs can be temporarily incomplete while typing.
    change(
      !keepHistorical && (form.fields[name].enum || form.fields[name].type === "boolean")
        ? normalizeForm(form, next, name)
        : next,
    );
  }
  return (
    <>
      {Object.entries(form.fields).map(([name, field]) => {
        const constraint = evaluated.fields[name];
        if (constraint && !constraint.visible) return null;
        const label = field.title ?? name,
          value = values[name],
          required = form.required?.includes(name),
          fieldDisabled = Boolean(constraint?.disabled);
        const options =
          field.enum ??
          (field.type === "boolean" && !required ? [true, false] : undefined);
        return (
          <label
            className={
              "parameter-button model-parameter" +
              (fieldDisabled ? " model-parameter-disabled" : "")
            }
            key={name}
            title={constraint?.disabledReason}
          >
            {label}
            {options ? (
              <select
                aria-label={label}
                disabled={fieldDisabled}
                value={JSON.stringify(value) ?? ""}
                onChange={(e) =>
                  edit(
                    name,
                    e.target.value ? JSON.parse(e.target.value) : undefined,
                  )
                }
              >
                {!required && <option value="">默认</option>}
                {value !== undefined && !options.includes(value) && <option disabled value={JSON.stringify(value)}>{String(value)}（旧参数）</option>}
                {options.map((option) => {
                  const key = JSON.stringify(option);
                  const disabledReason = constraint?.disabledOptions[key];
                  const autoAdjustReason =
                    !disabledReason && constraint?.incompatibleOptions[key];
                  const text = optionLabel(option, field.optionLabels);
                  return (
                    <option
                      key={key}
                      value={key}
                      disabled={Boolean(disabledReason)}
                      title={disabledReason || autoAdjustReason || undefined}
                    >
                      {disabledReason
                        ? `${text}（${disabledReason}）`
                        : autoAdjustReason
                          ? `${text}（联动调整）`
                          : text}
                    </option>
                  );
                })}
              </select>
            ) : field.type === "boolean" ? (
              <input
                type="checkbox"
                aria-label={label}
                disabled={fieldDisabled}
                checked={value === true}
                onChange={(e) => edit(name, e.target.checked)}
              />
            ) : (
              <input
                aria-label={label}
                type={field.type === "string" ? "text" : "number"}
                disabled={fieldDisabled}
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
      {keepHistorical && Object.keys(values).filter(name => !Object.hasOwn(form.fields, name)).map(name =>
        <button type="button" className="parameter-button" key={name} onClick={() => edit(name, undefined)}>
          移除旧参数 {name}（{String(values[name])}）
        </button>
      )}
      {evaluated.references.reason && (
        <span className="parameter-constraint-hint" role="status">
          {evaluated.references.reason}
        </span>
      )}
    </>
  );
}
