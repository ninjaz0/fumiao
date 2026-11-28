import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Ship editable sources exercised by the Studio author integration tests.
export async function writeAuthorTemplates(root, destination) {
  const sharpPackage = JSON.parse(
    await readFile(join(root, "node_modules/sharp/package.json"), "utf8"),
  );
  const templates = {
    importers: "example-importers",
    providers: "example-studio",
    nodePools: "node-pool",
    settingsPages: "example-extension",
    settings: "example-extension",
    pages: "example-review-board",
    canvasNodes: "canvas-node",
    actions: "example-review-notes",
    events: "example-asset-tags",
    chatTools: "example-reading-time",
    exporters: "storyboard",
    paymentMethods: "payments",
  };
  for (const [type, source] of Object.entries(templates)) {
    const input =
      type === "nodePools" || type === "canvasNodes"
        ? join(root, "packages", "plugin-sdk", "scaffolds", source)
        : join(root, "plugins", source),
      files = {};
    const read = (path) => readFile(join(input, path), "utf8");
    let release;
    if (type === "providers") {
      const manifest = JSON.parse(await read("manifest.json"));
      release = {
        format: 1,
        id: manifest.id,
        label: manifest.label,
        version: "1.0.0",
        adapterVersion: "1.0.0",
        remote: { endpoint: "http://127.0.0.1:4100", manifest },
      };
      files["server.mjs"] = await read("server.ts");
    } else {
      release = JSON.parse(await read("package/release.json"));
      if (type === "settings" || type === "settingsPages") {
        delete release.remote;
        release.extensionOnly = true;
        const page = release.contributes.settingsPages.find(
          (p) => p.id === (type === "settings" ? "display" : "notes"),
        );
        release.contributes = {
          version: 1,
          settingsPages: [page],
          ...(type === "settings"
            ? { settings: release.contributes.settings }
            : { hostCapabilities: ["data"] }),
        };
      }
      if (type === "paymentMethods")
        release.contributes.paymentMethods =
          release.contributes.paymentMethods.slice(0, 1);
      if (type === "events") delete release.contributes.actions;
      for (const nodes of Object.values(release.contributes)) {
        if (!Array.isArray(nodes)) continue;
        for (const node of nodes)
          if (node.programFile)
            files["package/" + node.programFile] = await read(
              "package/" + node.programFile,
            );
      }
      if (release.contributes.settings?.migrateFile) {
        const name = release.contributes.settings.migrateFile;
        files["package/" + name] = await read("package/" + name);
      }
      if (type === "nodePools") {
        for (const name of [
          "package/program.js",
          "client/worker.py",
          "client/pack.py",
          "distribution/install.sh",
        ])
          files[name] = await read(name);
      }
    }
    if (type === "importers")
      files["fixtures.json"] = await read("fixtures.json");
    files["package/release.json"] = JSON.stringify(release, null, 2) + "\n";
    await mkdir(destination, { recursive: true });
    await writeFile(
      join(destination, type + ".json"),
      JSON.stringify({
        sourceId: release.id,
        files,
        ...(type === "providers"
          ? { dependencies: { sharp: sharpPackage.version } }
          : {}),
      }) + "\n",
    );
  }
}
