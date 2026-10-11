---
name: review
description: Walk the user through an agentic-retro report, apply each proposal they accept, and record every outcome in the ledger. Use when the user opens a report in the agentic-retro reports folder, asks to review proposals or walk through a report, or follows the session-start notice to a new report. PR-mode output is reviewed on GitHub instead - redirect there.
---

# Review

Walk an agentic-retro report one proposal at a time. Apply what the user accepts, and record every outcome in the ledger.

## Find the report

- Use the report the user names, or the one they just opened
- With none named, use the newest file in the reports folder of the state folder (`$AGENTIC_RETRO_HOME`, default `~/.agentic-retro`) that still has an open proposal
- The session-start notice links the report to open

If the user points at a pull request instead of a report file, this is PR-mode output. Tell them to merge, close, or drop commits on GitHub. `agentic-retro sync` records the outcome from there, not this skill.

## Walk the proposals

The report groups proposals by repo, then by category. Walk it in that order.

For each proposal:

1. Check its status with `agentic-retro ledger --status open`. Skip it if a past session already settled it.
2. Show the plain one-line summary. Never show the `<details>` block first.
3. Show the `<details>` block only if the user asks for more.
4. Ask yes, no, or later. Use the host's question tool when one exists, such as `AskUserQuestion`. Otherwise ask in plain text.

## On yes

- A clarity or repo-for-agents proposal applies inside the repo the proposal names
- An agent-setup proposal applies only under a path listed in config `editable` (check with `agentic-retro config get editable`)
    - If the target falls outside every editable path, tell the user and skip the apply
    - Still ask whether to mark the proposal accepted, since the user may have made the change by hand
- Apply the change the `<details>` block describes, then show the user the diff
- Run `agentic-retro mark <id> accepted`

## On no

- Run `agentic-retro mark <id> rejected`
- Make no code change

## On later

- Leave the proposal open, and move to the next one
- It expires on its own after `expireAfterBatches` batches (default 3)

## Rules

- Never commit on the user's behalf unless they ask
- Never re-propose or reapply a proposal already accepted, rejected, or expired

## End

Close with a one-line tally: proposals accepted, rejected, and left open this pass.
