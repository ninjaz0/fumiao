#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
if [ -e .env ]; then
  echo ".env already exists; keep it with your deployment backups." >&2
  exit 1
fi
tmp=$(mktemp ./.env.init.XXXXXX)
trap 'rm -f "$tmp"' EXIT
docker run --rm -i --network none node:24-bookworm-slim node -e '
  const { randomBytes } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const template = readFileSync(0, "utf8");
  process.stdout.write(template
    .replace(/^POSTGRES_PASSWORD=$/m, "POSTGRES_PASSWORD=" + randomBytes(32).toString("hex"))
    .replace(/^ENCRYPTION_KEY=$/m, "ENCRYPTION_KEY=" + randomBytes(32).toString("base64")));
' < .env.example > "$tmp"
ln "$tmp" .env
