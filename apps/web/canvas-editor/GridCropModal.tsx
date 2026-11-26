import { useState } from "react";
import { Crop, Grid2X2, Grid3X3 } from "lucide-react";

export function GridCropModal({
  mediaId,
  defaultLayout = "3x3",
  onCrop,
  onClose,
}: {
  mediaId: string;
  defaultLayout?: "2x2" | "3x3";
  onCrop: (opts: {
    rows: 2 | 3;
    cols: 2 | 3;
    row: number;
    col: number;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<"2x2" | "3x3">(defaultLayout);
  const [selected, setSelected] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const size: 2 | 3 = layout === "2x2" ? 2 : 3;

  const cells: { row: number; col: number; index: number }[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      cells.push({ row: r, col: c, index: r * size + c + 1 });
    }
  }

  return (
    <div className="fm-grid-crop">
      <div className="fm-grid-crop-toolbar">
        <span>选择宫格布局：</span>
        <button
          type="button"
          className={layout === "2x2" ? "primary" : "secondary"}
          onClick={() => {
            setLayout("2x2");
            setSelected({ row: 0, col: 0 });
          }}
        >
          <Grid2X2 size={15} />
          2×2 四宫格
        </button>
        <button
          type="button"
          className={layout === "3x3" ? "primary" : "secondary"}
          onClick={() => {
            setLayout("3x3");
            setSelected({ row: 0, col: 0 });
          }}
        >
          <Grid3X3 size={15} />
          3×3 九宫格
        </button>
      </div>
      <div className="fm-grid-crop-stage">
        <img src={`/media/${mediaId}`} alt="宫格分镜预览图" />
        <div
          className="fm-grid-crop-overlay"
          style={{
            gridTemplateColumns: `repeat(${size}, 1fr)`,
            gridTemplateRows: `repeat(${size}, 1fr)`,
          }}
        >
          {cells.map((cell) => {
            const active =
              cell.row === selected.row && cell.col === selected.col;
            return (
              <button
                key={`${cell.row}-${cell.col}`}
                type="button"
                className={"fm-grid-cell" + (active ? " active" : "")}
                aria-label={`选择第 ${cell.index} 格`}
                aria-pressed={active}
                onClick={() => setSelected({ row: cell.row, col: cell.col })}
              >
                <span>#{cell.index}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <span>
          已选第 {selected.row * size + selected.col + 1} 格（第{" "}
          {selected.row + 1} 行第 {selected.col + 1} 列）
        </span>
        <div className="fm-grid-crop-btns">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onCrop({
                  rows: size,
                  cols: size,
                  row: selected.row,
                  col: selected.col,
                });
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Crop size={15} />
            {busy ? "裁切中…" : "裁切为新参考图 / 首帧"}
          </button>
        </div>
      </div>
    </div>
  );
}
