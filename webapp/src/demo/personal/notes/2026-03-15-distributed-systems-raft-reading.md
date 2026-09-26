---
date: 2026-03-15
type: reading
domain: [study]
epic: null
tags: [distributed-systems, raft, cs451, reading]
status: n/a
links:
  - tasks/2026-03-16-submit-raft-lab-3.md
---

# Reading: "In Search of an Understandable Consensus Algorithm" (Raft)

Reading for CS 451, week 8. Needed for lab 3.

## Key ideas

- **Leader election:** followers become candidates after a randomized election timeout (150 to
  300 ms). Randomization keeps split votes rare.
- **Log replication:** the leader appends entries and replicates them; an entry is committed once a
  majority has stored it.
- **Safety:** a candidate can only win if its log is at least as up to date as a majority's
  (election restriction).

## Questions for the TA

- Why can't a leader commit entries from previous terms by counting replicas (figure 8)?
- How small can the heartbeat interval go before the lab's network simulator starts dropping
  messages?

## Lab 3 notes

Persist `currentTerm`, `votedFor` and `log[]` before replying to any RPC.
