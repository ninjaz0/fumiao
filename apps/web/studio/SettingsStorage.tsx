import type { StudioState } from "./state";

const gb = (value: number) => (value / 1e9).toFixed(1);

export function StorageSettings({
  state: { used, reserved, quota, disk_free },
  viewLibrary,
}: {
  state: StudioState;
  viewLibrary: () => void;
}) {
  if (
    used === undefined ||
    reserved === undefined ||
    quota === undefined ||
    disk_free === undefined
  )
    return null;
  const percent = (used / quota) * 100;
  // Match the pinned markup's two decimal places and inline width serialization.
  return (
    <div className="settings-section">
      <h2>存储空间</h2>
      <p className="console-description">查看当前空间的媒体用量和任务预留容量。</p>
      <div className="ledger-card">
        <div className="storage-total">
          <strong>{`${gb(used)} GB`}</strong>
          <span>{` / ${quota / 1e9} GB`}</span>
        </div>
        <div
          className="storage-track"
          role="progressbar"
          aria-label="已用空间"
          aria-valuemin={0}
          aria-valuemax={100}
          ref={(track) =>
            track?.setAttribute("aria-valuenow", percent.toFixed(2))
          }
        >
          <span
            ref={(bar) => bar?.setAttribute("style", `width:${percent}%`)}
          />
        </div>
        <dl className="settings-facts">
          <dt>素材与成片</dt>
          <dd>{`${gb(used)} GB`}</dd>
          <dt>任务预留</dt>
          <dd>{`${gb(reserved)} GB`}</dd>
          <dt>可用空间</dt>
          <dd>{`${gb(Math.max(0, quota - used - reserved))} GB`}</dd>
          <dt>服务器可用磁盘</dt>
          <dd>{`${gb(disk_free)} GB`}</dd>
        </dl>
        <button
          className="quiet-button"
          data-nav="library"
          onClick={viewLibrary}
        >
          管理资产
        </button>
      </div>
    </div>
  );
}
