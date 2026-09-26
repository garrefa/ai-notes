#!/usr/bin/env bash
#
# release.sh — cut a release of the ainotes toolkit (the Claude Code plugin and the webapp viewer
# share one version number).
#
# What it does:
#   1. Requires a clean tree on the default branch, and an "## [Unreleased]" section in
#      CHANGELOG.md with at least one bullet under it — that section becomes the release notes.
#   2. Bumps the version in .claude-plugin/plugin.json and webapp/package.json to the given version.
#   3. Renames "## [Unreleased]" to "## [X.Y.Z] - YYYY-MM-DD" in CHANGELOG.md, adds a fresh empty
#      "## [Unreleased]" above it, and appends compare/tag links at the bottom.
#   4. Commits "Release vX.Y.Z" and tags it "vX.Y.Z" (annotated).
#
# It does NOT push. Push the commit and the tag yourself once you're happy:
#   git push && git push origin vX.Y.Z
# Pushing the tag is what triggers .github/workflows/release.yml, which builds webapp/, publishes
# ainotes-viewer to npm, and creates the GitHub Release from the CHANGELOG section.
#
# Usage:
#   tools/release.sh <version>          # e.g. tools/release.sh 0.2.0
#   tools/release.sh --dry-run <version>
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SRC"

DRY_RUN=0
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      [ -z "$VERSION" ] || { echo "only one version allowed" >&2; exit 1; }
      VERSION="$arg"
      ;;
  esac
done
[ -n "$VERSION" ] || { echo "usage: tools/release.sh [--dry-run] <version>" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "version must be semver (e.g. 0.2.0 or 0.2.0-rc.1), got: $VERSION" >&2
  exit 1
}
TAG="v$VERSION"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

log() { echo "release: $*"; }
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }

# --- preconditions -----------------------------------------------------------

[ -z "$(git status --porcelain)" ] || { echo "working tree isn't clean; commit or stash first" >&2; exit 1; }

DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"
CURRENT_BRANCH="$(git branch --show-current)"
if [ -n "$DEFAULT_BRANCH" ] && [ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]; then
  echo "on branch '$CURRENT_BRANCH', expected '$DEFAULT_BRANCH' — switch or pass --dry-run to test anyway" >&2
  [ "$DRY_RUN" = 1 ] || exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG already exists" >&2
  exit 1
fi

UNRELEASED_BODY="$(python3 - <<'PY'
import re, sys
text = open("CHANGELOG.md").read()
m = re.search(r"^## \[Unreleased\]\n(.*?)(?=^## \[|\Z)", text, re.S | re.M)
if not m:
    sys.exit("no '## [Unreleased]' section found in CHANGELOG.md")
body = m.group(1).strip("\n")
if not body.strip():
    sys.exit("'## [Unreleased]' section is empty — add changelog entries before releasing")
print(body)
PY
)" || { echo "release: $UNRELEASED_BODY" >&2; exit 1; }

log "changelog section for $TAG:"
echo "$UNRELEASED_BODY" | sed 's/^/  /'

# --- apply changes -----------------------------------------------------------

if [ "$DRY_RUN" = 1 ]; then
  log "dry run — no files touched, no commit, no tag"
  exit 0
fi

python3 - "$VERSION" <<'PY'
import json, sys
version = sys.argv[1]
for path in ("./.claude-plugin/plugin.json", "./webapp/package.json"):
    with open(path) as f:
        data = json.load(f)
    data["version"] = version
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY
log "bumped .claude-plugin/plugin.json and webapp/package.json to $VERSION"

python3 - "$VERSION" "$TAG" <<'PY'
import re, sys
from datetime import date

version, tag = sys.argv[1], sys.argv[2]
path = "CHANGELOG.md"
text = open(path).read()

dated_heading = f"## [{version}] - {date.today().isoformat()}"
text, n = re.subn(r"^## \[Unreleased\]", f"## [Unreleased]\n\n{dated_heading}", text, count=1, flags=re.M)
if n != 1:
    sys.exit("could not find '## [Unreleased]' heading to replace")

# Repoint the [Unreleased] compare link's base to the new tag, and add a link for this version.
text = re.sub(
    r"^\[Unreleased\]: .*/compare/v[^.]+\.\S+\.\.\.HEAD$",
    f"[Unreleased]: https://github.com/garrefa/ai-notes/compare/{tag}...HEAD",
    text,
    flags=re.M,
)
if f"[{version}]: " not in text:
    text = text.rstrip("\n") + f"\n[{version}]: https://github.com/garrefa/ai-notes/releases/tag/{tag}\n"

open(path, "w").write(text)
PY
log "updated CHANGELOG.md"

run git add .claude-plugin/plugin.json webapp/package.json CHANGELOG.md
run git commit -m "Release $TAG"
run git tag -a "$TAG" -m "Release $TAG"

log "done. Push when ready:"
log "  git push && git push origin $TAG"
