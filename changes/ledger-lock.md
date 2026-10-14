- Fix: `tools/check-prs.sh` no longer overwrites rows the ledger-keeper added to `PRS.md` while it
  was running (a lost update: six freshly registered PRs vanished from the ledger). Both now take
  a shared lock, the new `tools/ledger-lock.sh` (an atomic `mkdir <notes repo>/.ledger.lock`, stale
  after 10 minutes or when its owner is gone), around their ledger write and commit. `check-prs.sh`
  hashes `PRS.md` when it starts, re-checks under the lock, and redoes its run from the fresh file
  (3 attempts, then fails without writing) if it changed. `.ledger.lock/` joins the notes repo's
  gitignore rules (install adds it to existing notes repos).
- `check-prs.sh` also tracks open PRs assigned to you (`--assignee @me`), not just those you
  authored.
