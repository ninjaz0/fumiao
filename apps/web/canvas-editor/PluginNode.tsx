import type {
  CanvasExtension,
  CanvasNodeEntry,
} from "@fumiao/plugin-sdk/canvas-nodes";
import { Handle, Position } from "@xyflow/react";

export function PluginNodePorts({
  definition,
}: {
  definition: CanvasNodeEntry;
}) {
  return (["inputs", "outputs"] as const).map((side) =>
    definition[side].map((port, i) => (
      <Handle
        key={side + port.id}
        type={side === "inputs" ? "target" : "source"}
        id={port.id}
        position={side === "inputs" ? Position.Left : Position.Right}
        style={{ top: ((i + 1) / (definition[side].length + 1)) * 100 + "%" }}
        className="reference-handle"
        aria-label={port.title}
        title={port.title}
      >
        <span className="plugin-port-label">{port.title}</span>
      </Handle>
    )),
  );
}

export function PluginNodeOutputs({
  extension: e,
}: {
  extension: CanvasExtension;
}) {
  return (
    <div className="plugin-node-outputs nodrag nowheel">
      {e.definition.outputs.map((p) => {
        const value = e.result?.[p.id];
        if (!value) return null;
        if (p.kind === "text") return <p key={p.id}>{value}</p>;
        const src = "/media/" + value;
        if (p.kind === "image")
          return (
            <img
              key={p.id}
              src={src}
              alt={p.title}
              loading="lazy"
              decoding="async"
            />
          );
        if (p.kind === "audio")
          return <audio key={p.id} src={src} controls aria-label={p.title} />;
        return (
          <video
            key={p.id}
            src={src}
            preload="metadata"
            controls
            aria-label={p.title}
          />
        );
      })}
    </div>
  );
}

export function PluginNodeForm({
  extension: e,
  available,
  busy,
  change,
  run,
}: {
  extension: CanvasExtension;
  available: boolean;
  busy: boolean;
  change: (values: CanvasExtension["values"]) => void;
  run: () => void;
}) {
  const retired = e.definition.plugin === "example-shot-prompt";
  const disabled = retired || busy;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!retired && available && !busy) run();
      }}
    >
      {e.definition.fields.map((field) => {
        const value = e.values[field.id];
        const set = (v: string | number | boolean) =>
          change({ ...e.values, [field.id]: v });
        return (
          <label key={field.id}>
            {field.title}
            {field.type === "select" ? (
              <select
                disabled={disabled}
                value={String(value)}
                onChange={(e) => set(e.target.value)}
              >
                {field.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                type="checkbox"
                disabled={disabled}
                checked={value === true}
                onChange={(e) => set(e.target.checked)}
              />
            ) : field.type === "number" ? (
              <input
                type="number"
                step="any"
                disabled={disabled}
                value={Number(value)}
                onChange={(e) => {
                  if (Number.isFinite(e.target.valueAsNumber))
                    set(e.target.valueAsNumber);
                }}
              />
            ) : (
              <input
                maxLength={2000}
                disabled={disabled}
                value={String(value)}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </label>
        );
      })}
      {available && !retired ? (
        <button type="submit" disabled={busy}>
          运行节点
        </button>
      ) : (
        <p role="status">
          {retired
            ? "此示例插件节点已停用，仍可查看和复制已保存的输出"
            : `此节点需要启用 ${e.definition.plugin} ${e.definition.version}`}
        </p>
      )}
    </form>
  );
}
