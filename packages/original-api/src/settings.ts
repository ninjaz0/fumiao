import { StudioCatalog } from "../../platform/src/catalog.js";
import type { Platform, Actor } from "../../platform/src/platform.js";
import { identityBodies } from "./contracts.js";
import { parseBody } from "./validation.js";
export class OriginalSettings {
  readonly catalog: StudioCatalog;
  constructor(private p: Platform) {
    this.catalog = new StudioCatalog(p.db);
  }
  async models(actor: Actor, value: unknown) {
    const input = parseBody(value, identityBodies.modelPolicy);
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => {
      const result = await this.catalog.savePolicy(
        sql,
        input as Parameters<StudioCatalog["savePolicy"]>[1],
      );
      if (input.workspace === null)
        await sql.query("UPDATE original_state_settings SET image_enabled=$1", [
          result.image_enabled,
        ]);
      await this.p.audit(
        sql,
        actor,
        "studio.models",
        input.workspace === null ? "global" : String(input.workspace),
      );
      return result;
    });
  }
  async prices(actor: Actor, value: unknown) {
    const input = parseBody(value, identityBodies.modelPrices);
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => {
      const result = await this.catalog.savePrices(
        sql,
        input.values,
        input.expected_revision,
      );
      await this.p.audit(sql, actor, "studio.prices", "global");
      return result;
    });
  }
}
