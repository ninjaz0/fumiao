import { imageSettingsFixture } from "./image-settings.js";
import { chatProviderFixture } from "./chat-provider.js";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
import { OriginalChatSettings } from "@fumiao/original-api/chat-settings.js";
export async function chatSettingsFixture(throughMigration?: string) {
  const f = await imageSettingsFixture(throughMigration),
    wire = await chatProviderFixture();
  try {
    await f.db.transaction((sql) =>
      f.catalog.activate(sql, chatStreaming.manifest),
    );
    const ids: Record<string, string> = {};
    for (const model of ["deepseek-flash", "gpt-4.1"]) {
      const config = wire.config(model);
      const row = await f.p.createConnection(f.admin, {
        name: config.provider,
        pluginId: chatStreaming.manifest.id,
        version: chatStreaming.manifest.version,
        config,
      });
      ids[config.provider] = row.id;
      await f.db.query("UPDATE connections SET enabled=true WHERE id=$1", [
        row.id,
      ]);
    }
    return {
      ...f,
      wire,
      ids,
      settings: new OriginalChatSettings(f.p),
      async reset(keys: Record<string, string> = {}, fallback = "") {
        for (const model of ["deepseek-flash", "gpt-4.1"]) {
          const config = wire.config(model);
          await f.db.query(
            "UPDATE connections SET config=$2,enabled=true WHERE id=$1",
            [
              ids[config.provider],
              f.p.vault.seal({
                ...config,
                apiKey: keys[config.provider] ?? "",
              }),
            ],
          );
        }
        await f.db.query("UPDATE connections SET config=$2 WHERE id=$1", [
          f.connection,
          f.p.vault.seal({ ...f.config, apiKey: fallback }),
        ]);
      },
      async cleanup() {
        await wire.cleanup();
        await f.cleanup();
      },
    };
  } catch (error) {
    await wire.cleanup();
    await f.cleanup();
    throw error;
  }
}
