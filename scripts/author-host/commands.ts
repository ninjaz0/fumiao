import { parseArgs } from "node:util";
import { verifyLocalProvider } from "./provider.js";
import { authorSuite } from "./contracts.js";
import { serveAuthorProject } from "./serve.js";

export async function command(kind: string, args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options:
      kind === "dev"
        ? { port: { type: "string" } }
        : { service: { type: "string" } },
  });
  if (positionals.length > 1) throw Error("请指定一个插件目录");
  const directory = positionals[0] ?? ".";
  if (kind === "dev") {
    const port = Number(values.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("无效的监听端口");
    await serveAuthorProject(directory, port);
    return;
  }
  const suite = await authorSuite(directory);
  for (const item of suite.cases) {
    try {
      await suite.execute(item.id);
    } catch (error) {
      throw Error(
        item.id +
          " · " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
    console.log("通过 " + item.id);
  }
  if (typeof values.service === "string") {
    if (!suite.remote) throw Error("--service 仅用于远程提供方");
    await verifyLocalProvider(suite.remote, values.service);
  }
  if (!suite.cases.length) throw Error("没有可验证的扩展入口");
}
