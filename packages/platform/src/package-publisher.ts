import {
  publisherFingerprint,
  type PackageSignature,
} from "@fumiao/plugin-sdk/package-signing.js";
import { one, type Sql } from "./db.js";
import { hash, requireValue } from "./security.js";

// The installation row survives removal and still points to the last accepted
// immutable release. A pinned identity therefore also governs reinstall.
export async function pinnedPublisher(
  sql: Sql,
  id: string,
): Promise<PackageSignature | undefined> {
  const row = await one(
    sql,
    `SELECT r.package->'signature' AS signature FROM studio_packages p
    JOIN studio_package_releases r USING(id,version) WHERE p.id=$1`,
    [id],
  );
  return row?.signature ?? undefined;
}
export function publisherReview(
  previous: PackageSignature | undefined,
  next: PackageSignature | undefined,
) {
  const from = previous ? publisherFingerprint(previous.publicKey) : null;
  const to = next ? publisherFingerprint(next.publicKey) : null;
  const change =
    from && to && from !== to && next
      ? hash([from, to, next.value].join("/"))
      : null;
  return {
    name: next?.publisher ?? null,
    fingerprint: to,
    previousFingerprint: from,
    change,
  };
}
export function authorizePublisher(
  previous: PackageSignature | undefined,
  next: PackageSignature | undefined,
  confirmation?: string,
) {
  requireValue(
    !previous || next,
    409,
    "已固定发布者公钥，请选择已签名的插件包",
  );
  const { change } = publisherReview(previous, next);
  requireValue(
    !change || change === confirmation,
    409,
    "发布者公钥已更换，请核对指纹并重新确认",
  );
}
