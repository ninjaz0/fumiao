import { canvasesFixture } from "./canvases.js";

export async function stateJobsFixture() {
  const f = await canvasesFixture();
  try {
    await f.db.query("UPDATE users SET avatar='builtin:mountain'");
    await f.db.query("UPDATE workspaces SET created_at='2026-01-01'");
    const job = async (id: number, state = "queued", foreign = false) => {
      const row = await f.job(
        id,
        "video",
        state,
        undefined,
        foreign ? f.memberSpace : f.workspace,
        foreign ? f.member : f.admin,
      );
      await f.db.query(
        `UPDATE jobs SET provider_model='MiniMax H3',
        input='{"prompt":"fixture","params":{},"references":[]}',
        original_view=$2, created_at='2026-01-01', updated_at='2026-01-01' WHERE id=$1`,
        [
          row.id,
          JSON.stringify({
            ratio: "16:9",
            quality: "720p",
            seconds: 6,
            sampling_steps: 20,
            seed: 42,
            width: 1280,
            height: 720,
            image_quality: null,
            audio_settings: null,
            h3_inputs: [],
            refs: [],
          }),
        ],
      );
      return row;
    };
    return { ...f, job };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
