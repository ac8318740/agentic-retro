# agentic-retro

agentic-retro ("agentic-retrospective") learns from your finished coding sessions and proposes improvements, as a plugin for Claude Code, Codex, and Pi.

## How a batch runs

```mermaid
flowchart TD
    A["Session ends<br/>(hook in each harness)"] --> P{"Project enabled?"}
    P -->|no| Z["Stop"]
    P -->|yes| B["CLI adds session to queue"]
    B --> C{"5 sessions queued for this repo?"}
    C -->|no| Z
    C -->|yes| D["CLI writes digests and metrics,<br/>and updates past proposal outcomes"]
    D --> E["Runner starts one lead agent;<br/>it reviews each enabled category<br/>(Claude, Codex, Pi, or herdr pane)"]
    E --> F["Lead writes proposals,<br/>skipping anything rejected or expired before"]
    F --> G["Output: one PR per repo, or a report file"]
    G --> H["Next session start: hook prints<br/>'3 new proposals: link'"]
    H --> I["User reviews proposals"]
```

- A session-end hook queues sessions only for explicitly enabled repositories (`agentic-retro enqueue`)
- Once a repo has 5 queued sessions (configurable), the CLI starts a batch
- One lead agent runs per batch and waits for each enabled category: code clarity, agent setup, repo changes. It uses subagents when their results can be awaited, otherwise it runs categories sequentially
- Agents write proposals as a PR (one per repo) or a report file, per your setup choice

Collection includes eligible lead and teammate sessions, but never retro's own batch sessions. Attributable human feedback, corrections, and steering carry the strongest evidence in either kind of session; autonomous agent work remains useful, lower-weight evidence. A transcript's `user` role does not prove human authorship: Pi also records parent-agent briefs that way without speaker provenance. Digests mark user-role messages unverified, and finders retain unknown attribution when the source cannot be established.

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

### Pi: native package

```sh
pi install npm:agentic-retro
```

Restart Pi or run `/reload`, then invoke `/agentic-retro:setup`. This uses the package's bundled CLI, so no global `agentic-retro` install is needed. Select `pi` as the runner harness during setup; installing the package does not change that setting automatically.

Use the CLI from Pi, for example:

```text
/agentic-retro config set runner.harness pi
/agentic-retro project enable
/agentic-retro project status
```

Run the project commands from the repository you want reviewed. Do not also run `install-pi`: loading both the native package and legacy extension duplicates commands and hooks.

### Claude Code and Codex: plugin and CLI

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

Enable collection separately in each repository you want reviewed:

```sh
agentic-retro project enable
agentic-retro project status
# Stop collection and startup notices for this repository:
agentic-retro project disable
```

- Every repository starts disabled, including repositories used before this update
- Run these commands from any worktree or subdirectory, or pass `--cwd <dir>`
- All worktrees share the setting, including worktrees elsewhere on the machine
- Git stores `agentic-retro.enabled` in its shared local configuration, outside tracked files
- Separate clones require separate opt-in
- Disabling retains queued sessions but excludes them from future batches until re-enabled
- Disabling does not stop an already-running batch

For legacy standalone Pi installation only, install the CLI globally and run `agentic-retro install-pi`. This writes an extension file instead of using Pi's native package loader. Choose one installation path; do not load both.

Using Codex? It asks you to trust the new session-end hook the first time a session ends after install.

## Skills

- `run` – the batch agent's own skill; the runner starts it headless once a batch fills. For supervised Pi batches, use the explicit retry command below instead of rerunning the skill manually
- `review` – walks a report, applies each change you accept, and marks the ledger
- `setup` – drives the conversational config walkthrough
- `retro` – reads ledger outcomes and metrics over time into a retrospective

## CLI commands

- `agentic-retro about` – print a short intro to what agentic-retro does
- `agentic-retro setup` – interactive config, the human alternative to the setup skill
- `agentic-retro config list | get <key> | set <key> <value>` – read or write one global config key
- `agentic-retro project enable | disable | status [--cwd <dir>]` – control collection and notices for one repository
- `agentic-retro enqueue` – add a finished session to the queue (hooks call this)
- `agentic-retro propose` – record a new proposal (batch agents call this)
- `agentic-retro link <id>` – attach a PR and commit to a proposal
- `agentic-retro mark <id> <accepted|rejected>` – record a decision on a proposal
- `agentic-retro ledger` – list proposals, filtered by status
- `agentic-retro sync` – refresh proposal outcomes from GitHub, then expire stale ones
- `agentic-retro notice` – the session-start one-line proposal count (hooks call this)
- `agentic-retro stats` – acceptance rate per category, and tokens per changed line
- `agentic-retro install-pi` – write a legacy standalone Pi extension (not needed for native packages)
- `agentic-retro batch status <n> [--json]` – inspect a Pi batch's recorded lifecycle
- `agentic-retro batch retry <n>` – explicitly retry a failed or incomplete Pi batch from its preserved manifest
- `agentic-retro batch finish <n> --summary "..."` – the supervised agent's attempt-bound completion handshake

## Pi batch status and recovery

Pi batches run from their batch directory, not the target repository. A missing ACStack configuration there does not mean the target repository is unconfigured.

Each supervised Pi batch keeps `batch.json`, `run.log`, and `status.json` in `batches/<n>/` under the state folder. Queue removal means the agent started, not that it completed. `completed` requires both an explicit finish handshake and exit code 0. A nonzero exit is `failed`; exit 0 without the handshake is `incomplete`. The handshake records the agent's workflow summary, not independent proof that its findings are correct.

From Pi, inspect and recover with:

```text
/agentic-retro batch status 7 --json
/agentic-retro batch retry 7
```

Read `run.log` and the ledger before retrying: a partial run may already have created proposals or PRs. Retry reuses the same manifest and batch number; it does not automatically repeat runs. Active and completed attempts are refused. If a supervisor died, inspect its processes first, then use `batch retry <n> --recover-stale`; recovery refuses a supervisor that is still alive or whose state cannot be determined. Historical batches without status are unverified and require the same explicit inspection and recovery flag.

Detached Pi launches from an enforced ac-teams sandbox are refused, preserving the queue and manifest. The sandbox's access and proxy lifetime belong to its parent; agentic-retro never escapes it or removes access restrictions. Inspect the failure and start recovery later from an authorized independent context with the required access.

Claude Code, Codex, and herdr retain their existing launch behavior; this lifecycle protocol applies only to supervised Pi runs.

## State

- Runtime state lives under `~/.agentic-retro/` (override with `AGENTIC_RETRO_HOME`): config, queue, ledger, metrics, batch digests, and reports
- Repository activation lives in Git's shared local configuration and never enters the tracked checkout
- Keep runtime state outside repositories; Git ignores its own metadata automatically

## Working on agentic-retro

Run the tests with `npm test`.

- `cli/agentic-retro.js`: parses arguments and routes commands to their modules
- `cli/lib/`: CLI behavior, including:
    - `project.js`: repository opt-in shared by all worktrees
    - `queue.js` and `runner.js`: session collection and batch launch
    - `batch.js` and `pi-runner.js`: supervised Pi batch state and execution
    - `digest.js` and `transcripts/`: per-harness transcript parsing and digest generation
    - `ledger.js` and `outcomes.js`: proposals and their outcomes
    - `pi-extension.ts`: native Pi integration; `pi.js` installs the legacy standalone extension
- `skills/`: the `run`, `review`, `setup`, and `retro` skills
    - `skills/run/SKILL.md` owns the agent's branch, commit, and PR workflow; the CLI does not open PRs
- `hooks/`: Claude Code and Codex session hooks
- `docs/adr/`: architecture decision records
- `test/`: tests, with shared helpers in `test/helpers/`
