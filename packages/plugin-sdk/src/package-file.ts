import { z } from "zod";
import { contributesSchema } from "./contributions.js";
import { settingsPagesSchema } from "./settings-pages.js";

export const packageSignatureSchema = z
  .object({
    algorithm: z.literal("Ed25519"),
    publisher: z
      .string()
      .min(1)
      .max(100)
      .refine((s) => s.trim() === s && !/[\u0000-\u001f\u007f]/u.test(s)),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]{59}=$/),
    value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export type PackageSignature = z.infer<typeof packageSignatureSchema>;

export const releaseVersion = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
export const sourceURL = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search
    );
  });
export const packageFile = z
  .object({
    format: z.literal(1),
    signature: packageSignatureSchema.optional(),
    extensionOnly: z.literal(true).optional(),
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    label: z.string().trim().min(1).max(80),
    version: releaseVersion,
    adapterVersion: releaseVersion,
    manifest: z.record(z.string(), z.unknown()).optional(),
    equivalentModels: z.array(z.string().min(1).max(180)).max(500).optional(),
    updateUrl: sourceURL.optional(),
    nodeClient: z
      .object({
        "install.sh": z.string().max(128 * 1024),
        "agent.tgz": z.string().max(1024 * 1024),
        "agent.tgz.sha256": z.string().max(512),
      })
      .strict()
      .optional(),
    program: z
      .string()
      .min(1)
      .max(256 * 1024)
      .optional(),
    studioProgram: z
      .string()
      .min(1)
      .max(256 * 1024)
      .optional(),
    contributes: contributesSchema.optional(),
    settingsPages: settingsPagesSchema.optional(),
    settingsPage: z
      .object({
        title: z.string().min(1).max(60),
        render: z
          .string()
          .min(1)
          .max(64 * 1024),
      })
      .strict()
      .optional(),
    remote: z
      .object({
        endpoint: sourceURL,
        manifest: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (f) =>
      [f.manifest, f.remote, f.extensionOnly].filter(Boolean).length === 1 &&
      (!f.extensionOnly ||
        (!f.program &&
          !f.nodeClient &&
          !f.studioProgram &&
          !f.equivalentModels &&
          (f.contributes?.paymentMethods?.length ||
            f.contributes?.importers?.length ||
            f.contributes?.exporters?.length ||
            f.contributes?.events?.length ||
            f.contributes?.canvasNodes?.length ||
            f.contributes?.chatTools?.length ||
            f.contributes?.pages?.length ||
            f.contributes?.settingsPages?.length ||
            f.contributes?.settings ||
            f.contributes?.actions?.length))) &&
      (!f.manifest || !!f.program || !!f.manifest.chat || !!f.studioProgram),
    "插件必须声明一种执行方式",
  )
  .refine(
    (file) =>
      file?.settingsPage === undefined || file?.contributes === undefined,
    {
      message: "contributes 与旧版 settingsPage 不能同时声明",
      when: () => true,
    },
  );
export type PackageFile = z.infer<typeof packageFile>;
export type PackageInput = z.input<typeof packageFile>;
