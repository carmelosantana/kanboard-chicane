#!/usr/bin/env bash
# Smoke test for the race page: loads <url> in headless Chrome (SwiftShader WebGL), saves a screenshot,
# and fails on CSP violations, uncaught errors, console errors, or if race.js never logged chicane:mounted.
# Usage: Test/js/race-smoke.sh <url> <out.png>
set -euo pipefail
url=${1:?usage: race-smoke.sh <url> <out.png>}
out=${2:?usage: race-smoke.sh <url> <out.png>}
chrome=$(ls ~/.cache/ms-playwright/chromium_headless_shell-1234/*/chrome-headless-shell 2>/dev/null | head -n1)
[ -x "$chrome" ] || { echo "race-smoke: chrome-headless-shell not found" >&2; exit 2; }
log=$(mktemp); trap 'rm -f "$log"' EXIT
"$chrome" --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1440,900 \
  --virtual-time-budget=9000 --enable-logging=stderr --v=0 --screenshot="$out" "$url" 2>"$log" >/dev/null || true
if grep -E 'Content Security Policy|Uncaught|CONSOLE.*[Ee]rror' "$log"; then
  echo "race-smoke: FAIL (errors above)" >&2; exit 1
fi
if ! grep -q 'chicane:mounted' "$log"; then
  echo "race-smoke: FAIL (no chicane:mounted)" >&2; exit 1
fi
grep -o 'chicane:mounted.*", source' "$log" | head -n1 || true
echo "race-smoke: OK -> $out"
