- Agents: the six bookkeeping/polling agents (`notetaker`, `ledger-keeper`, `daily-plan-tracker`,
  `notes-extractor`, `pr-poller`, `review-inbox-poller`) pin `model: claude-haiku-5-5` instead of
  the floating `haiku` alias. The skills' general-purpose fallbacks still pass `model: haiku` (the
  Agent tool only accepts aliases) and now say it means Haiku 5.5.
