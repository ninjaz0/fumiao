import { createServer } from "node:http";
import { once } from "node:events";
import { databaseFixture } from "./database.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalImageSettings } from "@fumiao/original-api/image-settings.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { imagesSettings } from "@fumiao/plugin-images/settings.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
export type ProbeWire = {
  raw?: string;
  hex?: string;
  status?: number;
  disconnect?: boolean;
  repeat?: number;
};
export async function imageSettingsFixture() {
  let wire: ProbeWire = { raw: "{}" };
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    requests.push({
      path: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body: req.headers["content-length"] ?? null,
    });
    if (wire.disconnect) {
      req.socket.destroy();
      return;
    }
    res.writeHead(wire.status ?? 200, { "content-type": "application/json" });
    const bytes = wire.repeat
      ? Buffer.alloc(wire.repeat, 120)
      : wire.hex
        ? Buffer.from(wire.hex, "hex")
        : Buffer.from(wire.raw ?? "{}");
    for (let n = 0; n < bytes.length; n += 32768)
      if (!res.write(bytes.subarray(n, n + 32768))) await once(res, "drain");
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  let f: Awaited<ReturnType<typeof databaseFixture>> | undefined,
    app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    f = await databaseFixture();
    await f.p.registry.installBuiltins(f.db);
    const identity = new OriginalIdentity(f.p),
      password = "image-settings-fixture",
      catalog = new StudioCatalog(f.db);
    await identity.bootstrap({ name: "admin", nickname: "Admin", password });
    const adminToken = await identity.login(
        { name: "admin", password },
        "fixture",
      ),
      admin = await identity.actor(adminToken);
    await identity.createMember(admin, {
      name: "member",
      nickname: "Member",
      password,
    });
    const memberToken = await identity.login(
      { name: "member", password },
      "fixture",
    );
    await f.db.transaction((sql) =>
      catalog.activate(sql, imagesSettings.manifest),
    );
    const config = {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "sk-local-fixture",
      },
      connection = await f.p.createConnection(admin, {
        name: "fixture",
        pluginId: imagesSettings.manifest.id,
        version: imagesSettings.manifest.version,
        config,
      });
    app = await createOriginalApp(f.p);
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl(),
      tokens = [adminToken, memberToken, ""];
    return {
      ...f,
      url,
      tokens,
      admin,
      catalog,
      config,
      connection: connection.id,
      settings: new OriginalImageSettings(f.p),
      requests,
      setWire(value: ProbeWire) {
        wire = value;
      },
      async request(
        method: string,
        path: string,
        body?: unknown,
        actor = 0,
        origin = "http://localhost:3000",
      ) {
        const response = await fetch(url + path, {
            method,
            headers: {
              cookie: "fm_session=" + tokens[actor],
              origin,
              "content-type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
          text = await response.text();
        return {
          status: response.status,
          body: response.headers
            .get("content-type")
            ?.startsWith("application/json")
            ? JSON.parse(text)
            : text,
          contentType: response.headers.get("content-type"),
          allow: response.headers.get("allow"),
        };
      },
      async cleanup() {
        await app!.close();
        await close();
        await f!.cleanup();
      },
    };
  } catch (error) {
    await app?.close();
    await close();
    await f?.cleanup();
    throw error;
  }
}
