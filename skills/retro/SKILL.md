---
name: retro
description: Thin wrapper that runs `agentic-retro stats` and explains the result in plain words. Invoke when the user asks for a retrospective, or wants to see how their agentic-retro proposals are landing.
---

# Retro

Run `agentic-retro stats` and explain the result in plain words.

## Run it

```
agentic-retro stats
```

This reads the ledger (every proposal's outcome: accepted, rejected, or expired) and the metrics stored per session.

## Explain the result

Cover two things, both from `agentic-retro stats`:

- **Accepted share per category** – of every proposal in `clarity`, `agent-setup`, and `repo-for-agents`, the share the user accepted
    - A low share in one category means the user keeps rejecting that kind of change
- **Tokens per line of code over time** – how many tokens each batch spends per line changed, tracked across batches
    - A rising trend means sessions are costing more for the same amount of code

Keep the explanation short.

- Lead with the number or trend that matters most
    - Example: "Agent-setup proposals: 80% accepted. Clarity proposals: 20% accepted"
- Say what it suggests
    - Example: "Agents keep proposing clarity changes you reject - consider turning that category off"
- Skip any category with no proposals yet

## Why this matters

Batch agents read the accepted share before proposing changes. They propose less of what the user keeps rejecting. This skill shows the user the same numbers.
