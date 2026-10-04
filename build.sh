#!/usr/bin/env bash
# Build the submission-ready XPI for Laya Mail Triage.
set -euo pipefail
cd "$(dirname "$0")"

OUT="dist/laya-mail-triage.xpi"
mkdir -p dist
rm -f "$OUT"

# Zip the extension files themselves (not the containing directory).
zip -r "$OUT" \
  manifest.json \
  background.js \
  popup.html \
  popup.js \
  icons \
  LICENSE \
  -x '*.DS_Store' >/dev/null

echo "built $OUT ($(du -h "$OUT" | cut -f1))"
