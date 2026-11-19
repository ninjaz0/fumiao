import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const title = z.string().trim().min(1).max(80);
const field = z
  .object({
    id: identifier,
    label: title,
    options: z
      .array(title)
      .min(1)
      .max(64)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();

const distinctIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;

export const settingsPagesSchema = z
  .array(
    z
      .object({
        id: identifier,
        title,
        view: z.literal("fields"),
        fields: z
          .array(field)
          .min(1)
          .max(32)
          .refine(distinctIds, "页面字段标识重复"),
      })
      .strict(),
  )
  .max(32)
  .refine(distinctIds, "设置页标识重复");

export type PluginSettingsPage = z.infer<typeof settingsPagesSchema>[number];
export type InstalledSettingsPage = PluginSettingsPage & {
  plugin: string;
  label: string;
  version: string;
  revision: number;
  removing: boolean;
  values: Record<string, string>;
};
