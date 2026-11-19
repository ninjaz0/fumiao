import type { Actor, Platform } from "../../platform/src/platform.js";
import { ReferencePacks, type PackDraft } from "../../platform/src/packs.js";
import { OriginalIdentity } from "./identity.js";
import { parseBody } from "./validation.js";
import { identityBodies } from "./contracts.js";
export class OriginalPacks {
  readonly packs: ReferencePacks;
  readonly identity: OriginalIdentity;
  constructor(readonly p: Platform) {
    this.packs = new ReferencePacks(p.db);
    this.identity = new OriginalIdentity(p);
  }
  async list(user: Actor, selected?: string) {
    const workspace = await this.identity.activeWorkspace(
      this.p.db,
      user,
      selected,
    );
    return this.packs.list(user, workspace.id);
  }
  async save(user: Actor, value: unknown, selected?: string, key?: string) {
    const draft = parseBody(value, identityBodies.packDraft, true) as PackDraft;
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.view(
        sql,
        await this.packs.save(sql, user, workspace.id, draft, key),
      );
    });
  }
  async remove(user: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.remove(sql, user, key, workspace.id);
    });
  }
}
