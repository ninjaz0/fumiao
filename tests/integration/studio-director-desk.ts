import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, expect, type APIRequestContext, type Route } from "@playwright/test";
import { one } from "@fumiao/platform/db.js";
import type { Platform } from "@fumiao/platform/platform.js";
import type { Manifest } from "@fumiao/plugin-sdk/index.js";
import { newNode, type Job, type Project } from "../../apps/web/canvas-editor/types.js";
import { mediaModel } from "./studio-remote-provider.js";
import sharp from "sharp";

function ffmpeg(args: string[]) {
  return execFileSync("ffmpeg", ["-v", "error", "-threads", "1", "-filter_threads", "1", ...args], { timeout: 20000 });
}

function mockClip(color: string, frequency: number) {
  return ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=96x54:r=24:d=1`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=1`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
  ]);
}

function mockVoice(frequency: number) {
  return ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=0.32`, "-f", "wav", "pipe:1"]);
}

function outputColor(path: string, seconds: number) {
  return [...ffmpeg(["-ss", String(seconds), "-i", path, "-frames:v", "1", "-vf", "scale=1x1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"])];
}

function outputTone(path: string, seconds: number, frequency: number) {
  const bytes = ffmpeg(["-ss", String(seconds), "-i", path, "-t", "0.13", "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"]);
  let real = 0, imaginary = 0;
  for (let i = 0; i < bytes.length / 2; i++) {
    const phase = 2 * Math.PI * frequency * i / 16000;
    const sample = bytes.readInt16LE(i * 2);
    real += sample * Math.cos(phase);
    imaginary += sample * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / (bytes.length / 2);
}

function outputDuration(path: string) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }));
}

export async function verifyDirectorDesk(
  platform: Platform,
  web: string,
  user: { name: string; password: string },
) {
  const red = mockClip("red", 330);
  const alt = mockClip("magenta", 500);
  const clip = mockClip("yellow", 950);
  const green = mockClip("green", 450);
  const blue = mockClip("blue", 850);
  const voices = { first: mockVoice(600), second: mockVoice(700), narration: mockVoice(1050) };
  const prompts = { first: "第一镜正片", dialogue: "第二镜对白", narration: "第三镜旁白", line1: "对白首次失败", line2: "对白成功保留", voice: "单独的本集旁白" };
  const calls: { kind: string; prompt: string }[] = [];
  const provider = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(204).end();
      return;
    }
    void (async () => {
      assert.equal(req.url, "/submit");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const { kind, input } = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = input.prompt as string;
      const prior = calls.filter((call) => call.kind === kind && call.prompt === prompt).length;
      calls.push({ kind, prompt });
      const json = (result: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      if (!prior && (prompt === prompts.dialogue || prompt === prompts.line1)) {
        json({ state: "failed", error: "local fixture rejects first attempt" });
        return;
      }
      const mime = kind === "video" ? "video/mp4" : "audio/wav";
      const file = kind === "video"
        ? prompt === prompts.first ? prior ? alt : red : prompt === prompts.dialogue ? green : blue
        : prompt === prompts.line1 ? voices.first : prompt === prompts.line2 ? voices.second : voices.narration;
      json({
        state: "completed",
        artifacts: [{ url: `data:${mime};base64,${file.toString("base64")}` }],
      });
    })().catch(() => res.writeHead(500).end());
  }).listen(0, "127.0.0.1");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await once(provider, "listening");
    browser = await chromium.launch();
    const admin = await browser.newContext({ baseURL: web });
    const member = await browser.newContext({ baseURL: web, viewport: { width: 1300, height: 850 } });
    async function api<T = any>(client: APIRequestContext, path: string, data?: unknown, method = data === undefined ? "GET" : "POST", workspace?: number, status = 200): Promise<T> {
      const response = await client.fetch(path, {
        method,
        data,
        headers: { Origin: web, ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}) },
      });
      assert.equal(response.status(), status, `${path} ${await response.text()}`);
      return response.json();
    }
    await api(admin.request, "/api/login", user);
    const manifest: Manifest = JSON.parse(await readFile("plugins/example-studio/manifest.json", "utf8"));
    manifest.models.push(mediaModel("video"), mediaModel("audio"));
    await api(admin.request, "/api/admin/plugins/import", { file: {
      format: 1, id: manifest.id, label: manifest.label, version: manifest.version, adapterVersion: manifest.version,
      remote: { manifest, endpoint: `http://127.0.0.1:${(provider.address() as AddressInfo).port}` },
    } }, "POST", undefined, 201);
    await api(admin.request, "/api/admin/connections", {
      name: "导演台本地提供方", pluginId: manifest.id, version: manifest.version, config: { apiKey: "test-only" },
    }, "POST", undefined, 201);
    const { revision } = (await api(admin.request, "/api/admin/plugins")).find(({ id }: { id: string }) => id === manifest.id);
    await api(admin.request, `/api/admin/plugins/${manifest.id}/state`, { action: "enable", revision }, "POST", undefined, 201);
    const edge = (await api(admin.request, "/api/admin/plugins")).find(({ id }: { id: string }) => id === "edge-tts");
    if (edge?.enabled) await api(admin.request, "/api/admin/plugins/edge-tts/state", { action: "disable", revision: edge.revision }, "POST", undefined, 201);
    // The legacy canvas composer lists only models with a canvas form. The
    // loopback remote fixture uses the same declared video fields in either UI.
    await platform.db.query(
      `UPDATE plugin_model_forms SET forms=jsonb_set(forms, '{local-demo-video,canvas}', 'true')
       WHERE plugin_id=$1 AND plugin_version=$2`,
      [manifest.id, manifest.version],
    );
    await platform.db.query("INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING");
    const login = { name: "director-member", password: randomUUID() };
    const invite = await api(admin.request, "/api/invite-codes", { name: "导演台合成成员" });
    await api(member.request, "/api/register", { ...login, nickname: "导演台成员", code: invite.code });
    const memberState = await api(member.request, "/api/state");
    assert.equal(memberState.me.role, "member");
    await member.clearCookies();
    const team = await api(admin.request, "/api/workspaces", { name: "导演台合成测试", members: [memberState.me.id] });
    await api(admin.request, "/api/admin/credits/adjust", { workspace: team.id, amount: 100, note: "合成测试", uid: randomUUID() });
    const page = await member.newPage();
    await page.goto("/studio");
    await page.locator('[name="user"]').fill(login.name);
    await page.locator('[name="pw"]').fill(login.password);
    await page.locator('.auth-form [type="submit"]').click();
    await expect(page.locator(".shell")).toBeVisible();
    await page.getByRole("button", { name: /^切换工作区/ }).click();
    await page.getByRole("option", { name: /导演台合成测试/ }).click();
    await expect.poll(async () => (await api(member.request, "/api/state")).workspace_id).toBe(team.id);
    const request = <T = any>(path: string, data?: unknown, method?: string) => api<T>(member.request, path, data, method, team.id);
    const upload = async (bytes: Buffer, filename: string, type: string) => {
      const res = await member.request.post("/api/assets", {
        headers: { Origin: web, "X-Workspace-Id": String(team.id), "X-File-Name": filename, "Content-Type": type },
        data: bytes,
      });
      assert.equal(res.status(), 200, await res.text());
      return (await res.json()).id as string;
    };
    const trialId = randomUUID();
    const trialMedia = trialId.replaceAll("-", "");
    const trialKey = "director-fixture-" + trialMedia;
    await platform.storage.put(trialKey, clip, "video/mp4");
    await platform.db.query(
      `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind)
       SELECT $1,$2,w.id,u.id,$3,'video/mp4',$4,'ready','video'
       FROM workspaces w CROSS JOIN users u WHERE w.public_id=$5 AND u.public_id=$6`,
      [trialId, trialMedia, trialKey, clip.length, team.id, memberState.me.id],
    );
    const image = await upload(await sharp({ create: { width: 96, height: 54, channels: 3, background: "#5289b3" } }).png().toBuffer(), "ref.png", "image/png");
    const script = await request("/api/workspace/scripts", { path: "第一集.md",
      body_md: "# 第一集\n\n## S01 室内·日\n\n△第一镜正片。\n\n△第二镜对白。\n\n林默：对白首次失败\n\n初夏：对白成功保留\n\n△第三镜旁白。" });
    const canvas = await request<Project>("/api/canvases", { title: "导演台单集出片" });
    const shot = { ...newNode("video", 400, 100, 1), id: "real-first", title: "S01-01 正片", prompt: prompts.first, audio_strategy: "keep_original" as const, params: { ...newNode("video", 400, 100, 1).params, model: "local-demo-video" } };
    const reference = { ...newNode("image", 20, 100, 1), id: "real-reference", title: "固定参考图", use_media: true, media_id: image };
    const trial = { ...shot, id: "excluded-trial", title: "试拍", use_media: true, media_id: trialMedia };
    const path = `/api/canvases/${canvas.id}`;
    await request(path + "/document", {
      title: canvas.title,
      expected_revision: canvas.revision,
      document: {
        schemaVersion: 1, nodes: [shot, trial, reference], shots: [trial.id, shot.id],
        edges: [{ id: "ref-first", source: reference.id, target: shot.id }],
        director: { script_id: script.id, script_revision: script.revision, shot_ids: [shot.id] },
      },
    }, "PUT");
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "画布", exact: true }).click();
    await page.getByRole("link", { name: "打开画布 " + canvas.title }).click();
    const directorTab = page.getByRole("tab", { name: "导演台" });
    await directorTab.click();
    const desk = page.getByRole("region", { name: "导演台" });
    const episode = desk.getByRole("region", { name: "本集成片预览与导出" });
    await expect(desk.getByRole("heading", { name: "本集成片" })).toBeVisible({ timeout: 5000 });
    const confirmOrder = async () => {
      await desk.getByRole("button", { name: "保存并确认顺序" }).click();
      await expect(desk.getByRole("button", { name: "顺序已确认" })).toBeDisabled();
    };
    const confirmShot = async () => {
      await desk.getByRole("button", { name: "确认分镜", exact: true }).click();
      await expect(desk.getByRole("button", { name: "分镜已确认" })).toBeDisabled();
      await desk.getByRole("button", { name: "确认素材", exact: true }).click();
      await expect(desk.getByRole("button", { name: "素材已确认" })).toBeDisabled();
    };
    const dialog = () => page.getByRole("dialog").filter({ has: page.getByRole("button", { name: /确认冻结.*积分并提交/ }) });
    const receiptDialog = () => page.getByRole("dialog");
    const submitQuote = async () => {
      await dialog().getByRole("button", { name: /确认冻结.*积分并提交/ }).click();
    };
    const closeReceipt = async () => {
      await page.getByRole("button", { name: "确认回执并关闭" }).click();
    };
    const runs = async () => (await request<{ runs: Job[] }>(path + "/runs")).runs;
    const waitForRun = async (id: number, status: string) => {
      await expect.poll(async () => (await runs()).find((job) => job.id === id)?.status, { timeout: 25_000 }).toBe(status);
    };
    const batchPath = `**${path}/batch-runs`;
    let acceptedJob = 0;
    let lostBatch: unknown;
    const loseBatch = async (route: Route) => {
      lostBatch = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      const receipt = await response.json();
      assert.equal(receipt.submitted.length, 1);
      acceptedJob = receipt.submitted[0].job_id;
      await route.abort("failed");
    };
    await confirmOrder();
    await confirmShot();
    await expect(episode.getByRole("button", { name: "合成本集" })).toBeDisabled();
    await page.route(batchPath, loseBatch, { times: 1 });
    await desk.getByRole("button", { name: /^预检视频/ }).click();
    await submitQuote();
    await expect(page.getByRole("dialog").getByText("提交响应中断，请恢复上次提交。")).toBeVisible();
    await page.reload();
    await directorTab.click();
    await desk.getByRole("button", { name: "恢复上次提交" }).click();
    const replayed = page.waitForRequest((run) => run.method() === "POST" && run.url().endsWith(path + "/batch-runs"));
    await receiptDialog().getByRole("button", { name: "恢复上次提交" }).click();
    assert.deepEqual((await replayed).postDataJSON(), lostBatch);
    await expect(page.getByRole("heading", { name: /已接单 1 项/ })).toBeVisible();
    await closeReceipt();
    await waitForRun(acceptedJob, "done");
    assert.equal((await one(platform.db,
      "SELECT count(*)::int AS n FROM ledger WHERE action='hold' AND job_id=(SELECT id FROM jobs WHERE public_id=$1)", [acceptedJob])).n, 1);
    await desk.getByRole("button", { name: "采用此视频" }).click();
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    assert.equal((await request<Project>(path)).document.nodes.find(({ id }) => id === shot.id)?.active_job, acceptedJob);

    const newerScript = await request("/api/workspace/scripts/" + script.id, {
      expected_revision: script.revision, body_md: script.body_md + "\n\n> 保存后更新的剧本说明",
    }, "PUT");
    await episode.getByRole("button", { name: "合成本集" }).click();
    await expect(episode.getByRole("alert")).toContainText("主剧本已更新");
    let lostExport: unknown;
    let firstExportId = "";
    const exportUrl = `**${path}/exports`;
    await page.route(exportUrl, async (route) => {
      lostExport = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      firstExportId = (await response.json()).id;
      await route.abort("failed");
    }, { times: 1 });
    await episode.getByRole("button", { name: `合成已确认剧本版本 ${script.revision}` }).click();
    await expect(episode.getByRole("button", { name: "恢复本集合成提交" })).toBeEnabled();
    await page.reload();
    await directorTab.click();
    const replayExport = page.waitForRequest((run) => run.method() === "POST" && run.url().endsWith(path + "/exports"));
    await episode.getByRole("button", { name: "恢复本集合成提交" }).click();
    assert.deepEqual((await replayExport).postDataJSON(), lostExport);
    const downloadLatest = async () => {
      const latest = episode.locator(".composition-results > div").first();
      const mp4 = latest.getByRole("link", { name: "MP4", exact: true });
      await expect(mp4).toBeVisible({ timeout: 30_000 });
      await latest.getByRole("button", { name: "预览", exact: true }).click();
      const video = latest.locator("video");
      await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
      await video.evaluate(async (element) => {
        const player = element as HTMLVideoElement;
        player.muted = true;
        await player.play();
      });
      await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
      const source = (await video.getAttribute("src"))!;
      const partial = await member.request.get(source, { headers: { Range: "bytes=0-63" } });
      assert.equal(partial.status(), 206);
      assert.equal((await partial.body()).length, 64);
      const anonymous = await browser!.newContext({ baseURL: web });
      try {
        assert.equal((await anonymous.request.get(source, { maxRedirects: 0 })).status(), 401);
      } finally {
        await anonymous.close();
      }
      const [download] = await Promise.all([page.waitForEvent("download"), mp4.click()]);
      const savedDownload = await member.request.get(source + "?download=true");
      assert.match(savedDownload.headers()["content-type"], /^video\/mp4/);
      return (await download.path())!;
    };
    const firstPreview = await downloadLatest();
    assert.ok(outputDuration(firstPreview) < 1.2, "only one shot, without the excluded trial");
    const [r, g, b] = outputColor(firstPreview, 0.4);
    assert.ok(r > 200 && g < 50 && b < 50);
    assert.ok(outputTone(firstPreview, 0.3, 330) > 300);
    const history = (await request(path + "/exports?scope=episode")).exports;
    assert.deepEqual(history.map(({ id }: { id: string }) => id), [firstExportId]);
    assert.deepEqual((await request(path + "/exports?scope=canvas")).exports, []);
    console.log("PASS director exports only adopted shots: recovered both real receipts, one credit hold, red original audio, private preview and MP4, trial excluded");
    assert.equal(newerScript.revision, script.revision + 1);

    const saved = await request<Project>(path);
    const second = {
      ...shot, id: "real-second", title: "S01-02 对白", prompt: prompts.dialogue,
      audio_strategy: "replace" as const, x: 760,
      dialogue_lines: [
        { id: "line-first", speaker: "林默", text: prompts.line1, model: "local-demo-audio" },
        { id: "line-second", speaker: "初夏", text: prompts.line2, model: "local-demo-audio" },
      ],
      narration_text: "有对白时不使用这一条旁白",
    };
    const third = {
      ...shot, id: "real-third", title: "S01-03 旁白", prompt: prompts.narration,
      audio_strategy: "mix" as const, x: 1120, original_audio_gain: 0.5,
      narration_model: "local-demo-audio", narration_text: prompts.voice,
    };
    await request(path + "/document", {
      expected_revision: saved.revision,
      expected_script_revision: newerScript.revision,
      title: saved.title,
      document: {
        ...saved.document,
        nodes: [...saved.document.nodes, second, third],
        shots: [trial.id, shot.id, second.id, third.id],
        edges: [...saved.document.edges, { id: "ref-third", source: reference.id, target: third.id }],
        director: {
          ...saved.document.director,
          script_revision: newerScript.revision,
          order_basis: undefined,
          shot_ids: [shot.id, second.id, third.id],
        },
      },
    }, "PUT");
    await page.reload();
    await directorTab.click();
    await confirmOrder();
    const selectShot = (title: string) => desk.getByRole("button", { name: new RegExp("^" + title) });
    await selectShot("S01-02").click();
    await confirmShot();
    await selectShot("S01-03").click();
    await confirmShot();
    const stagePaths = {
      precheck: path + "/batch-precheck",
      runs: path + "/batch-runs",
    };
    const accept = async () => {
      const receipt = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith(stagePaths.runs));
      await submitQuote();
      const response = await receipt;
      assert.equal(response.status(), 200, await response.text());
      const batch = await response.json() as { submitted: { node: string; stage: string; line_id?: string; job_id: number }[]; skipped: unknown[] };
      assert.deepEqual(batch.skipped, []);
      return batch.submitted;
    };
    await selectShot("S01-01").click();
    await desk.getByRole("button", { name: /^预检视频/ }).click();
    const [extra] = await accept();
    await waitForRun(extra.job_id, "done");
    await closeReceipt();
    const compare = desk.getByText(/^比较视频候选/);
    await compare.click();
    const versionPanel = (job: number) => desk.locator(`.version-compare section:has(select option:checked[value="${job}"])`);
    await versionPanel(extra.job_id).getByRole("button", { name: "采用这一版" }).click();
    await expect.poll(async () => (await request<Project>(path)).document.nodes.find(({ id }) => id === shot.id)?.active_job).toBe(extra.job_id);
    await versionPanel(acceptedJob).getByRole("button", { name: "采用这一版" }).click();
    await expect.poll(async () => (await request<Project>(path)).document.nodes.find(({ id }) => id === shot.id)?.active_job).toBe(acceptedJob);

    for (const title of ["S01-02", "S01-03"]) {
      await desk.getByRole("checkbox", { name: new RegExp(`^选择${title}.*参与批量生成`) }).check();
    }
    await desk.getByRole("button", { name: /^预检视频/ }).click();
    const videoBatch = await accept();
    assert.deepEqual(videoBatch.map(({ node }) => node), [second.id, third.id]);
    await waitForRun(videoBatch[0].job_id, "failed");
    await waitForRun(videoBatch[1].job_id, "done");
    const retryOnly = async (name: string | RegExp, targets: { node_id: string; stage: string; line_id?: string }[]) => {
      const preview = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith(stagePaths.precheck));
      await receiptDialog().getByRole("button", { name }).click();
      const response = await preview;
      assert.equal(response.status(), 200, await response.text());
      assert.deepEqual(response.request().postDataJSON().director.targets, targets);
      const job = await accept();
      assert.equal(job.length, targets.length);
      return job[0].job_id;
    };
    const videoRetryId = await retryOnly("重新预检并补跑", [{ node_id: second.id, stage: "video" }]);
    await closeReceipt();
    await waitForRun(videoRetryId, "done");
    await desk.getByRole("button", { name: /^预检待生成音频/ }).click();
    const audioBatch = await accept();
    assert.deepEqual(audioBatch.map(({ node, stage, line_id }) => ({ node, stage, line_id })), [
      { node: second.id, stage: "dialogue", line_id: "line-first" },
      { node: second.id, stage: "dialogue", line_id: "line-second" },
      { node: third.id, stage: "narration", line_id: undefined },
    ]);
    await waitForRun(audioBatch[0].job_id, "failed");
    await waitForRun(audioBatch[1].job_id, "done");
    await waitForRun(audioBatch[2].job_id, "done");
    const audioRetryId = await retryOnly(/^仅补跑.*对白首次失败/, [{ node_id: second.id, stage: "dialogue", line_id: "line-first" }]);
    await closeReceipt();
    await waitForRun(audioRetryId, "done");
    await expect.poll(async () => {
      const document = (await request<Project>(path)).document;
      const dialogue = document.nodes.find(({ id }) => id === second.id)?.dialogue_lines;
      return [dialogue?.[0]?.audio_job, dialogue?.[1]?.audio_job, document.nodes.find(({ id }) => id === third.id)?.narration_job];
    }).toEqual([audioRetryId, audioBatch[1].job_id, audioBatch[2].job_id]);
    for (const title of ["S01-02", "S01-03"]) {
      await selectShot(title).click();
      await desk.getByRole("button", { name: "采用此视频" }).click();
      await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    }
    await episode.getByRole("button", { name: "合成本集" }).click();
    await expect(episode.locator(".composition-results > div")).toHaveCount(2);
    const secondPreview = await downloadLatest();
    const runtime = outputDuration(secondPreview);
    assert.ok(runtime >= 3 && runtime < 3.4, `expected three one-second shots, saw ${runtime}`);
    const samples = [0.4, 1.4, 2.5].map((seconds) => outputColor(secondPreview, seconds));
    assert.ok(samples[0][0] > 200 && samples[0][1] < 50 && samples[0][2] < 50, "first shot retains explicitly adopted red clip");
    assert.ok(samples[1][1] > 100 && samples[1][0] < 50 && samples[1][2] < 50, "second shot is green");
    assert.ok(samples[2][2] > 200 && samples[2][0] < 50 && samples[2][1] < 50, "third shot is blue");
    assert.ok(outputTone(secondPreview, 0.4, 330) > 300 && outputTone(secondPreview, 0.4, 500) < 100, "retained original take's source audio");
    const dialogueTone1 = outputTone(secondPreview, 1.12, 600);
    const dialogueTone2 = outputTone(secondPreview, 1.59, 700);
    assert.ok(dialogueTone1 > 300 && dialogueTone2 > 300 && outputTone(secondPreview, 1.12, 450) < 100, "two dialogue lines replace the original sound");
    assert.ok(outputTone(secondPreview, 2.13, 1050) > 300 && outputTone(secondPreview, 2.13, 850) > 100, "narration mixes with original audio");
    const count = (kind: string, prompt: string) => calls.filter((call) => call.kind === kind && call.prompt === prompt).length;
    assert.equal(count("video", prompts.dialogue), 2);
    assert.equal(count("video", prompts.narration), 1);
    assert.equal(count("audio", prompts.line1), 2);
    assert.equal(count("audio", prompts.line2), 1);
    assert.equal(count("audio", prompts.voice), 1);
    console.log("PASS director three shots: completed, selectively retried and compared real candidates; verified MP4 order, replace, mix, and original audio");

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(selectShot("S01-03")).toHaveAttribute("aria-pressed", "true");
    await desk.getByRole("button", { name: "定位素材节点" }).click();
    await page.getByRole("button", { name: "替换内容", exact: true }).click();
    const library = page.getByRole("dialog", { name: "资产库" });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      library.getByRole("button", { name: "上传图片", exact: true }).click(),
    ]);
    await chooser.setFiles({
      name: "mobile-reference.png", mimeType: "image/png",
      buffer: await sharp({ create: { width: 96, height: 54, channels: 3, background: "#834221" } }).png().toBuffer(),
    });
    await directorTab.click();
    await expect(selectShot("S01-03")).toHaveAttribute("aria-pressed", "true");
    await expect(desk.getByText(/本镜分镜或素材已变更，视频待确认/)).toBeVisible();
    assert.notEqual((await request<Project>(path)).document.nodes.find(({ id }) => id === reference.id)?.media_id, image);
    // The changed reference is shared by the first and third shots.
    await selectShot("S01-02").click();
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    await selectShot("S01-03").click();
    await desk.getByRole("button", { name: "确认沿用已采用视频" }).click();
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    await page.reload();
    await directorTab.click();
    await expect(selectShot("S01-03")).toHaveAttribute("aria-pressed", "true");
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    await expect(desk.locator("aside[aria-label=本集片单]").locator("li")).toHaveCount(3);
    await expect(episode.getByRole("link", { name: "MP4", exact: true })).toHaveCount(2);
    console.log("PASS director mobile: replaced canvas reference, retained focused shot, explicitly kept prior adoption, and restored playlist on reload");

    const withAdoption = await request<Project>(path);
    const secondRun = (await runs()).find((run) => run.id === videoRetryId)!;
    assert.ok(secondRun.result);
    await request(path + "/document", {
      expected_revision: withAdoption.revision,
      title: withAdoption.title,
      document: {
        ...withAdoption.document,
        nodes: withAdoption.document.nodes.map((node) => node.id === second.id
          ? { ...node, use_media: true, active_job: null, media_id: secondRun.result }
          : node),
      },
    }, "PUT");
    await page.setViewportSize({ width: 1300, height: 850 });
    await page.reload();
    await directorTab.click();
    await selectShot("S01-02").click();
    await desk.getByRole("button", { name: "确认沿用已采用视频" }).click();
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    await desk.getByRole("button", { name: "定位画布" }).click();
    const generate = page.getByRole("button", { name: "生成", exact: true });
    await expect(generate).toHaveAttribute("title", "生成");
    const [ordinaryResponse] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" &&
        res.url().endsWith(`/nodes/${second.id}/candidates`)),
      generate.click(),
    ]);
    assert.equal(ordinaryResponse.status(), 200, await ordinaryResponse.text());
    await waitForRun((await ordinaryResponse.json()).ids[0], "done");
    const checkDirectPin = async () => {
      const current = (await request<Project>(path)).document.nodes.find(({ id }) => id === second.id)!;
      assert.deepEqual([current.use_media, current.active_job, current.media_id], [true, null, secondRun.result]);
    };
    await checkDirectPin();
    await directorTab.click();
    await desk.getByRole("button", { name: /^预检视频/ }).click();
    const [supplement] = await accept();
    await closeReceipt();
    await waitForRun(supplement.job_id, "done");
    await checkDirectPin();
    await expect(desk.getByText(/本镜视频已采用/)).toBeVisible();
    console.log("PASS director pinned direct asset: ordinary and Director supplemental jobs preserved explicit reuse");
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
}
