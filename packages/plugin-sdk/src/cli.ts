#!/usr/bin/env node
import { createProject, writeRelease } from "./author-project.js";
import { publisherCommand } from "./publisher-cli.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "dev" || command === "test") {
    const host = await import(
      new URL("../bin/commands.js", import.meta.url).href
    );
    await host.command(command, args);
  } else if (command === "create")
    console.log(await createProject(args[0], args[1]));
  else if (command === "build") console.log(await writeRelease(args[0] ?? "."));
  else if (["keygen", "sign", "verify"].includes(command))
    console.log(await publisherCommand(command, args));
  else
    throw Error(
      "用法：fumiao-plugin <create|dev|test|build|keygen|sign|verify> [参数]",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : "命令失败");
  process.exitCode = 1;
}
