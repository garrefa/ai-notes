#!/bin/sh
# Opens the AINotes viewer (https://github.com/garrefa/ai-notes), always the latest release.
# Arguments pass through, e.g. ./run-viewer.sh --port 5000 --no-open
#
# ainotes: installed by install.sh — re-run the install with --force to update this file;
# --uninstall removes it.

if ! command -v npx >/dev/null 2>&1; then
  echo "run-viewer.sh: npx not found — install Node.js 20.19+ or 22.12+ (https://nodejs.org)." >&2
  exit 1
fi

# --yes skips npx's "Ok to proceed?" prompt the first time a new version is fetched.
exec npx --yes ainotes-viewer@latest "$@"
