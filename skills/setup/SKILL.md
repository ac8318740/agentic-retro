---
name: setup
description: Thin wrapper that walks the user through agentic-retro's config conversationally, then writes every answer with `agentic-retro config set`. Invoke when the user asks to set up, configure, or run setup for agentic-retro.
---

# Setup

Walk the user through agentic-retro's config, one question at a time, then write each answer with `agentic-retro config set <key> <value>`.

## Check the CLI is on PATH

1. Run `command -v agentic-retro`.
2. If the command is missing, tell the user to run `npm install -g agentic-retro`, then stop.

## Ask each question

Use the host's question tool (for example `AskUserQuestion`) when one is available. Otherwise ask in plain chat, one question at a time.

Offer the presets below for each question, and let the user type a different answer instead.

1. **Batch size** – sessions per batch, default 5
2. **Grouping** – `repo` (default) or `global`
3. **Runner harness** – `claude`, `codex`, or `pi`; add `herdr` to the choices only if `command -v herdr` finds it
4. **Model** – `opus` or `default`; `opus` applies to Claude, Codex and Pi use their own default unless given a model name they understand (for example `o3`)
5. **Runner permissions** – how much the batch agent can do without asking:
    - `auto` (default) – the harness's own auto mode
    - `scoped` – file edits, plus only `git`, `gh`, and `agentic-retro` commands
    - `bypass` – no checks at all
6. **Categories** – which proposal categories run: `clarity`, `agent-setup`, `repo-for-agents` (each true or false, all true by default)
7. **Scope** – how far clarity proposals look: `touched`, `neighbours`, or `two-layers`
8. **Output** – `pr` (opens a pull request per batch) or `report` (writes a report file)
9. **Auto-merge** – merge low-risk agent-setup PRs automatically? Default off
10. **Expire after** – batches an open proposal waits before it expires with no action, default 3
11. **Targets** – where agent-setup proposals go: `~/.claude/skills`, `~/.codex/skills`, or a plugin repo path
    - Also ask for a free-text note the batch agent reads, for example: "I develop spechub; send spechub fixes to the spechub repo at ~/spechub"
12. **Editable paths** – which paths proposals can write to, as a JSON list; every other path stays read-only
13. **Notes** – free text, anything else the batch agents should know

Write each answer right after the user gives it:

```
agentic-retro config set batch.size 5
agentic-retro config set batch.group repo
agentic-retro config set runner.harness claude
agentic-retro config set runner.model opus
agentic-retro config set runner.permissions auto
agentic-retro config set categories.clarity true
agentic-retro config set categories.agent-setup true
agentic-retro config set categories.repo-for-agents true
agentic-retro config set scope touched
agentic-retro config set output pr
agentic-retro config set autoMergeLowRisk false
agentic-retro config set expireAfterBatches 3
agentic-retro config set targets.preset ~/.claude/skills
agentic-retro config set targets.note "I develop spechub; send spechub fixes to ~/spechub"
agentic-retro config set editable '["~/.claude/skills"]'
agentic-retro config set notes "ask about this"
```

Never edit `config.json` by hand. `config set` is the only path that keeps the stored config merged with its defaults correctly.

## Offer the Pi extension

Run `command -v pi`. If it finds Pi, ask whether to install the agentic-retro extension for it. On yes, run `agentic-retro install-pi`.

## Finish

Run `agentic-retro config list` and show the user the result.
