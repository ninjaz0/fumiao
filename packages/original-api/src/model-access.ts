import { ModelAccessConnections } from "@fumiao/platform/model-access/connections.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";
import type {
  ModelAccessView,
  ModelConnection,
  ModelDiscovery,
  ModelDraft,
} from "@fumiao/web-compat/model-access.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";

/** Each method accepts an actor authenticated by the browser-session controller. */
export class OriginalModelAccess {
  private readonly connections: ModelAccessConnections;
  constructor(
    private readonly identity: OriginalIdentity,
    http?: HttpTransport<string | Uint8Array>,
  ) {
    this.connections = new ModelAccessConnections(
      identity.p.db,
      identity.p.vault,
      http,
    );
  }
  async view(actor: OriginalActor): Promise<ModelAccessView> {
    this.identity.p.admin(actor);
    return this.connections.view();
  }
  async create(actor: OriginalActor, input: unknown): Promise<ModelConnection> {
    this.identity.p.admin(actor);
    return this.connections.create(input);
  }
  async edit(
    actor: OriginalActor,
    id: string,
    input: unknown,
  ): Promise<ModelConnection> {
    this.identity.p.admin(actor);
    return this.connections.edit(id, input);
  }
  async discover(
    actor: OriginalActor,
    id: string,
    input: unknown,
  ): Promise<ModelDiscovery> {
    this.identity.p.admin(actor);
    return this.connections.discover(id, input);
  }
  async saveDraft(
    actor: OriginalActor,
    id: string,
    input: unknown,
  ): Promise<{ draft: ModelDraft }> {
    this.identity.p.admin(actor);
    return this.connections.saveDraft(id, input);
  }
}
