# agentic-retro

agentic-retro ("agentic-retrospective") learns from your finished coding sessions and proposes improvements, as a plugin for Claude Code, Codex, and Pi.

## How a batch runs

```mermaid
flowchart TD
    A["Session ends<br/>(hook in each harness)"] --> B["CLI adds session to queue"]
    B --> C{"5 sessions queued for this repo?"}
    C -->|no| Z["Stop"]
    C -->|yes| D["CLI writes digests and metrics,<br/>and updates past proposal outcomes"]
    D --> E["Runner starts one lead agent;<br/>it runs one subagent per ticked category<br/>(Claude, Codex, Pi, or herdr pane)"]
    E --> F["Subagents write proposals,<br/>skipping anything rejected or expired before"]
    F --> G["Output: one PR per repo, or a report file"]
    G --> H["Next session start: hook prints<br/>'3 new proposals: link'"]
    H --> I["User reviews proposals"]
```

- A session-end hook in each harness queues the session (`agentic-retro enqueue`)
- Once a repo has 5 queued sessions (configurable), the CLI starts a batch
- One lead agent runs per batch, and it runs one subagent per ticked category: code clarity, agent setup, repo changes
- Agents write proposals as a PR (one per repo) or a report file, per your setup choice

## The life of a proposal

```mermaid
stateDiagram-v2
    [*] --> open
    open --> accepted: merged, or user says yes
    open --> rejected: closed, removed, or user says no
    open --> expired: 3 batches with no action
```

- Every proposal starts `open` in the ledger (`~/.agentic-retro/ledger.json`)
- It becomes `accepted` or `rejected` once you act on it, or `expired` after 3 batches with no action (configurable)
- agentic-retro never re-proposes a rejected or expired item

## Install

You need Node.js 20 or later.

Add the marketplace and install the plugin:

```
/plugin marketplace add ac8318740/ac-agentic-coding
/plugin install agentic-retro@ac-agentic-coding
```

Install the CLI the plugin's hooks call into:

```
npm install -g agentic-retro
```

Run setup, either from the CLI or with the bundled skill:

```
agentic-retro setup
```

```
/agentic-retro:setup
```

- The `setup` skill asks every question itself and writes each answer with `agentic-retro config set`
- `agentic-retro setup` runs the same questions as plain interactive prompts – the human alternative to the skill

Both write the same `~/.agentic-retro/config.json`:

- batch size and grouping
- runner harness and permissions (`auto`, `scoped`, or `bypass`)
- which categories run, and the output mode (PR or report)
- where agent-setup proposals land

Using Pi? Run `agentic-retro install-pi` once. Pi has no hook config, so this extension queues finished Pi sessions and shows the notice.

Using Codex? It asks you to trust the new session-end hook the first time a session ends after install.

## Skills

- `run` – the batch agent's own skill; the runner starts it headless once a batch fills, and you can also invoke it to rerun a batch
- `review` – walks a report, applies each change you accept, and marks the ledger
- `setup` – drives the conversational config walkthrough
- `retro` – reads ledger outcomes and metrics over time into a retrospective

## CLI commands

- `agentic-retro about` – print a short intro to what agentic-retro does
- `agentic-retro setup` – interactive config, the human alternative to the setup skill
- `agentic-retro config list | get <key> | set <key> <value>` – read or write one config key
- `agentic-retro enqueue` – add a finished session to the queue (hooks call this)
- `agentic-retro propose` – record a new proposal (batch agents call this)
- `agentic-retro link <id>` – attach a PR and commit to a proposal
- `agentic-retro mark <id> <accepted|rejected>` – record a decision on a proposal
- `agentic-retro ledger` – list proposals, filtered by status
- `agentic-retro sync` – refresh proposal outcomes from GitHub, then expire stale ones
- `agentic-retro notice` – the session-start one-line proposal count (hooks call this)
- `agentic-retro stats` – acceptance rate per category, and tokens per changed line
- `agentic-retro install-pi` – write the Pi extension that stands in for Pi's missing hooks

## State

Everything lives under `~/.agentic-retro/` (override with `AGENTIC_RETRO_HOME`): `config.json`, `queue.json`, `ledger.json`, `metrics.jsonl`, per-batch digests, and report files.

## Working on agentic-retro

Run the tests with `npm test`.

- `cli/agentic-retro.js` – parses argv and routes each command to its module
- `cli/lib/` – one module per concern; each file's first line says what it owns
    - `queue.js` and `runner.js` – sessions wait in the queue, then the runner starts a batch
    - `digest.js` and `transcripts/` – one transcript parser per harness, feeding the digests
    - `ledger.js` and `outcomes.js` – proposals, and `sync`, which settles them from their PRs
    - `pi.js` and `pi-extension.ts` – the Pi extension that stands in for hooks
- `skills/` – the `run`, `review`, `setup` and `retro` skills
    - The `run` skill opens the PRs, not the CLI: its `SKILL.md` holds the branch, commit and PR steps
- `hooks/` – the Claude Code and Codex session hooks
- `docs/adr/` – architecture decision records
- `test/` – one `*.test.js` per area, with shared helpers in `test/helpers/`
