- `ax-pr-review`: PII findings are major and blocking. The reviewer flags a finding about personal
  data (in logs, traces, metrics, responses, third-party calls or unclassified fields) with a new
  `pii` field. `tools/pr-review.sh` raises it to at least major, labels it `[major · PII]`, and posts
  the review as request changes instead of a plain comment, recording `changes_requested` in the
  ledger and the review note. Reviews without PII findings still approve or comment as before.
