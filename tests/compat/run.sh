#!/usr/bin/env bash
#
# Builds the client, packs it, installs the tarball the way a consumer would,
# and runs the compatibility harness against a Trino coordinator.
#
# Override the coordinator with TRINO_SERVER, which defaults to
# http://localhost:8080.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${here}/../.." && pwd)"

echo "==> building and packing the client"
cd "${root}"
yarn build
yarn pack --out "${here}/candidate.tgz"

echo "==> installing the tarball as a consumer would"
cd "${here}"
npm install --no-audit --no-fund --loglevel=error
npm install --no-audit --no-fund --loglevel=error --no-save ./candidate.tgz

echo "==> type checking against the published declarations"
npx tsc --noEmit -p tsconfig.json

echo "==> running the harness against ${TRINO_SERVER:-http://localhost:8080}"
npx ts-node src/harness.ts
