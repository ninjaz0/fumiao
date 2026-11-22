import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Express } from "express";
import { createOriginalApp } from "../../apps/api/src/original.js";
import type { Platform } from "../../packages/platform/src/platform.js";
import { originalUI } from "../../packages/web-compat/src/ui.js";

const nextPaths = new Set([
  "/",
  "/avatars/{filename}",
  "/canvas",
  "/canvas/{project_id}",
  "/static/{file}",
  "/studio",
  "/studio/",
]);

const examples = {
  "/avatars/{filename}": "/avatars/alpine.svg",
  "/avatars/uploads/{filename}": "/avatars/uploads/" + "0".repeat(32) + ".webp",
  "/connect/{file}": "/connect/install.sh",
  "/media/{key}": "/media/" + "0".repeat(32),
  "/static/{file}": "/static/mark.svg",
  "/studio/": "/studio/?q=a%20b&q=%2F",
};

const params: Record<string, string> = {
  action: "stop",
  cid: "1",
  i: "1",
  job_id: "1",
  key: "0".repeat(32),
  method: "unknown",
  nid: "synthetic",
  node: "1",
  oid: "FM" + "0".repeat(24),
  pid: "1",
  project_id: "1",
  provider: "deepseek",
  request_id: "00000000-0000-4000-8000-000000000001",
  secret: "unissued-ticket",
  uid: "1",
  wid: "1",
};

type Contract = { method: string; path: string };
type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
};

async function registeredRoutes(p: Platform) {
  const nest = await createOriginalApp(p);
  try {
    await nest.init();
    const express = nest.getHttpAdapter().getInstance() as Express;
    return (express.router.stack as Layer[]).flatMap(({ route }) =>
      route ? [route] : [],
    );
  } finally {
    await nest.close();
  }
}

const shape = (path: string) => path.replace(/\{[^/{}]+\}|:[^/]+/g, "{}");

async function checkNext(response: Response, { method, path }: Contract) {
  const body = await response.bytes();
  if (path === "/studio/") {
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/studio?q=a%20b&q=%2F");
  } else if (path === "/canvas") {
    // The probe is anonymous; the canvas list is a member page.
    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get("location")!, "http://probe.invalid")
        .pathname,
      "/studio",
    );
  } else {
    assert.equal(response.status, 200);
    if (path.startsWith("/static/") || path.startsWith("/avatars/")) {
      const type = response.headers.get("content-type");
      assert.equal(type, "image/svg+xml");
      if (method === "GET") {
        const file = path.startsWith("/static/")
          ? "mark.svg"
          : "avatars/alpine.svg";
        assert.deepEqual(Buffer.from(body), await originalUI().file(file));
      }
    } else {
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      if (method === "GET") {
        const html = Buffer.from(body).toString();
        const pageMarker =
          path === "/"
            ? /data-session="guest"/
            : path === "/studio"
              ? /id="app"/
              : /id="canvas-root"/;
        assert.match(html, pageMarker);
      }
    }
  }
  if (method === "HEAD") assert.equal(body.length, 0);
}

export async function auditRoutes(
  p: Platform,
  web: string,
  api: string,
  showRoutes: boolean,
) {
  const { routes }: { routes: Contract[] } = JSON.parse(
    await readFile("baseline/contracts/routes.json", "utf8"),
  );
  assert.equal(routes.length, 120);
  assert.equal(
    new Set(routes.map(({ method, path }) => method + " " + path)).size,
    120,
  );
  const registered = await registeredRoutes(p);
  assert.equal(
    registered.filter(
      ({ path, methods }) => shape(path) === "/api/users/{}" && methods.delete,
    ).length,
    1,
    "Expected a single member deletion controller",
  );
  const failures: string[] = [];
  let next = 0;
  let nest = 0;
  let retired = 0;
  const probes = routes.map(({ method, path }) => ({
    method,
    path,
    retired: /^\/(?:api\/(?:admin\/)?)?fmworker\//.test(path),
    url:
      examples[path as keyof typeof examples] ??
      path.replace(/\{([^/{}]+)\}/g, (_, param) => {
        assert.ok(params[param], "Missing probe value for " + param);
        return params[param];
      }),
    init: (): RequestInit => ({
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { origin: web },
    }),
  }));
  for (const probe of probes) {
    const { method, path, url, init } = probe;
    const label = method + " " + path;
    try {
      if (probe.retired) {
        assert.ok(!registered.some((r) => shape(r.path) === shape(path)), label);
        const [direct, gateway] = await Promise.all([
          fetch(api + url, init()),
          fetch(web + url, init()),
        ]);
        assert.equal(direct.status, 404);
        assert.equal(gateway.status, 410);
        assert.deepEqual(await gateway.json(), { detail: "贡献服务已停用" });
        await direct.body?.cancel();
        retired++;
        if (showRoutes) console.log(`${label}\tRetired\t410`);
        continue;
      }
      if (nextPaths.has(path)) {
        const response = await fetch(web + url, init());
        await checkNext(response, { method, path });
        next++;
        if (showRoutes) console.log(`${label}\tNext\t${response.status}`);
        continue;
      }
      // Materialize Nest's actual Express router. Validation middleware and a
      // method-neutral gateway can respond even without a matching controller.
      const exact = registered.filter(
        (route) => shape(route.path) === shape(path),
      );
      assert.ok(exact.length, "No exact Nest controller path");
      const verb = method.toLowerCase();
      assert.ok(
        exact.some(
          ({ methods }) =>
            methods[verb] ||
            (path === "/api/recharge/notify/{method}" && methods._all),
        ),
        "Nest controller does not handle this method",
      );
      const [direct, proxied] = await Promise.all([
        fetch(api + url, init()),
        fetch(web + url, init()),
      ]);
      const [directBytes, gatewayBytes] = await Promise.all([
        direct.bytes(),
        proxied.bytes(),
      ]);
      assert.equal(proxied.headers.get("x-fumiao-web"), "next");
      assert.equal(proxied.status, direct.status);
      assert.ok(
        direct.status < 500 && direct.status !== 405,
        `Unexpected backend HTTP ${direct.status} ${Buffer.from(directBytes).toString()}`,
      );
      if (direct.status === 404) {
        assert.notEqual(
          Buffer.from(directBytes).toString(),
          '{"detail":"Not Found"}',
        );
      }
      for (const name of ["content-type", "location", "allow"])
        assert.equal(proxied.headers.get(name), direct.headers.get(name), name);
      assert.deepEqual(gatewayBytes, directBytes);
      nest++;
      if (showRoutes) console.log(`${label}\tNest\t${proxied.status}`);
    } catch (error) {
      failures.push(label + " — " + (error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual({ next, nest, retired }, { next: 11, nest: 95, retired: 14 });
  console.log(
    `Verified ${next} Next-owned, ${nest} Nest-owned and ${retired} retired method/path pairs`,
  );

  const missing = await fetch(web + "/api/__isolated_route_missing__");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { detail: "Not Found" });
  const wrongMethod = await fetch(web + "/api/users/1", { method: "PATCH" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "DELETE");
  const wrongCallback = await fetch(web + "/api/recharge/notify/unknown", {
    method: "PUT",
  });
  assert.equal(wrongCallback.status, 405);
  assert.equal(wrongCallback.headers.get("allow"), "GET, POST");
  const avatar = await fetch(web + "/avatars/unrecognized.svg");
  assert.equal(avatar.status, 404);
  assert.deepEqual(await avatar.json(), { detail: "头像不存在" });
  assert.deepEqual(await (await fetch(web + "/health")).json(), {
    service: "fumiao",
    ok: true,
  });

  return async () => {
    for (const { method, path, url, init, retired } of probes) {
      const response = await fetch(web + url, init());
      if (retired) {
        assert.equal(response.status, 410, method + " " + path);
        assert.deepEqual(await response.json(), { detail: "贡献服务已停用" });
      } else if (nextPaths.has(path)) await checkNext(response, { method, path });
      else {
        assert.equal(response.status, 502, method + " " + path);
        if (method !== "HEAD")
          assert.deepEqual(await response.json(), { detail: "后端暂时不可用" });
      }
    }
    console.log(
      "With Nest stopped, 95 forwarded routes return 502, 14 retired routes return 410 and all 11 original local routes still respond",
    );
  };
}
