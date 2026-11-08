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
    E --> F["Lead writes proposals,<br/>skipping duplicate pending or rejected changes"]
    F --> G["Output: one PR per repo, or a report file"]
    G --> H["Next session start: hook prints<br/>'3 new proposals: link'"]
    H --> I["User reviews proposals"]
```

- A session-end hook queues sessions only for explicitly enabled repositories (`agentic-retro enqueue`)
- Once a repo has 5 queued sessions (configurable), the CLI starts a batch
- One lead agent runs per batch and waits for each enabled category: code clarity, agent setup, repo changes. It uses subagents when their results can be awaited, otherwise it runs categories sequentially
- Agents write proposals as a PR (one per repo) or a report file, per your setup choice

Collection includes eligible lead and teammate sessions, but never retro's own batch sessions. Attributable human feedback, corrections, and steering carry the strongest evidence in either kind of session; autonomous agent work remains useful, lower-weight evidence. A transcript's `user` role does not prove human authorship: Pi also records parent-agent briefs that way without speaker provenance. Digests mark user-role messages unverified, and finders retain unknown attribution when the source cannot be established. Pi questionnaire answers are surfaced separately as untrusted tool output with raw transcript line references, without inventing user turns. These previews remain bounded; inspect the raw questions and answers when needed.

The aim is fewer repeated corrections and avoidable steps without weaker results, not more proposals or code. Finders distinguish missing guidance from guidance that was not loaded or applied, and from tooling defects, before adding instructions. A proposal being adopted does not prove it helped: related later work can show its effect; without a comparable opportunity, the effect remains unknown.

## The life of a proposal

```mermaid
stateDiagram-v2
    [*] --> open
    open --> accepted: merged surviving ID, adoption evidence, or manual yes
    open --> neutral: closed or merged without proposal ID
    neutral --> accepted: adoption evidence
    neutral --> rejected: evidence that this change was declined
    neutral --> open: PR reopened
    open --> rejected: manual no
```

- Every proposal starts `open` in the ledger (`~/.agentic-retro/ledger.json`)
- Untouched PRs and reports stay open, however long you wait. Closure, silence, and a missing proposal ID are not rejection
- `sync` accepts a proposal whose ID survives in merged PR commits. Closed PRs and merged PRs without that ID become `neutral`, pending inference; reopened PRs return to `open`
- The scheduled `run` agent automatically infers each proposal's outcome from closure explanations and current or replacement source. It records `accepted`, `rejected`, or `neutral` with a reason, evidence URLs, and `inferred` provenance. A mixed PR can adopt documentation while declining automatic installs. Ambiguity remains neutral and is revisited each run
- `mark` records an authoritative manual decision. Neither inference nor sync overrides it. Legacy accepted/rejected entries without provenance are protected too; old automatic verdicts need separate, backed-up historical reconciliation
- `sync` recovers legacy `expired` entries as pending before checking PR state. Old `expireAfterBatches` settings are ignored. It does not invoke a model; semantic inference runs in the existing batch agent
- agentic-retro suppresses duplicate pending or rejected changes, not whole topics. A distinct follow-on improvement can reference a prior proposal without repeating its patch. Changes requiring an unmerged proposal are deferred until their prerequisite lands
- Acceptance rates use only accepted and rejected proposals; open, neutral, and legacy expired proposals do not count as negative feedback. Inferred outcomes are interpretations, not independent human endorsement; inspect their provenance with `ledger --json`
- A no-proposals review records the candidates checked and why they failed the category criteria; it does not imply there is nothing left to improve

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

### Claude Code and Codex: plugin package

Add the marketplace and install the plugin:

```
/plugin marketplace add ac8318740/ac-agentic-coding
/plugin install agentic-retro@ac-agentic-coding
```

The marketplace's npm source installs the plugin manifest, hooks, skills, and CLI together. Hooks and skills use that package's CLI; no global install is required. Git-sourced plugin installs use the same bundled CLI.

Run the bundled setup skill:

```
/agentic-retro:setup
```

For terminal use, `npm install -g agentic-retro` is optional. It provides the `agentic-retro` command, including interactive `agentic-retro setup`. Without it, run `node "<installed-plugin-directory>/cli/agentic-retro.js"` in place of `agentic-retro` in the examples below. Skills resolve this path from their own package directory.

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

Approve plugin hooks when your host requests trust. Native npm installation and discovery of both `SessionStart` and `SessionEnd` hooks are tested with Codex 0.163; older versions may require an upgrade.

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
- `agentic-retro mark <id> <accepted|rejected>` – record an authoritative manual decision on a proposal
- `agentic-retro resolve <id> <accepted|rejected|neutral> --reason <text> --evidence <https-url>` – record the batch agent's inference (repeat `--evidence` for multiple sources). Requires a proposal ID, nonblank reason (at most 4000 characters, no control characters), and 1 to 20 HTTPS evidence URLs without credentials. Evidence is stored, not fetched or executed; the agent must assess its relevance and attribution
- `agentic-retro ledger [--status <s>[,<s>...]] [--json]` – list proposals; JSON includes reasons, evidence, and decision provenance
- `agentic-retro sync` – refresh observable PR state, leave unknown closure intent neutral, and recover legacy inactivity expiries
- `agentic-retro notice` – a deduplicated session-start summary of completed reviews (including no proposals), failed or incomplete attempts, and new proposals (hooks call this)
- `agentic-retro stats` – acceptance rate per category, and tokens per changed line
- `agentic-retro candidates list --batch <n>` – unresolved repo-local and shared-tool evidence for a review
- `agentic-retro candidates save --batch <n> --file <json-path>` – retain compact evidence or a terminal disposition (record format in `skills/run/SKILL.md`)
- `agentic-retro install-pi` – write a legacy standalone Pi extension (not needed for native packages)
- `agentic-retro batch status <n> [--json]` – inspect a Pi batch's recorded lifecycle
- `agentic-retro batch retry <n>` – explicitly retry a failed or incomplete Pi batch from its preserved manifest
- `agentic-retro batch finish <n> --summary "..."` – the supervised agent's attempt-bound completion handshake

## Pi batch status and recovery

Pi batches run from their batch directory, not the target repository. A missing ACStack configuration there does not mean the target repository is unconfigured.

Each supervised Pi batch keeps `batch.json`, `run.log`, and `status.json` in `batches/<n>/` under the state folder. Queue removal means the agent started, not that it completed. `completed` requires both an explicit finish handshake and exit code 0. A nonzero exit is `failed`; exit 0 without the handshake is `incomplete`. The handshake records the agent's workflow summary, not independent proof that its findings are correct.

At session start, a compact notice summarizes terminal attempts for the current repository since its last notice, even when completed reviews produced no proposals. Failures and incomplete attempts appear first. A retry's new terminal result can notify again; active attempts and historical batches without status are not counted as completed. New proposal links retain their existing notice behavior. Batch agents never notify themselves.

Pi session digests retain ac-teams launch, resume, and stop attempts with raw transcript references, member identifiers, and observed results. Missing results stay unknown; a launch attempt or resume is not a confirmed new subagent. Token metrics include available input, output, cache read, and cache write counts for that transcript. Missing counts remain unknown. Whole-team usage requires every relevant member transcript; member references alone do not establish coverage.

From Pi, inspect and recover with:

```text
/agentic-retro batch status 7 --json
/agentic-retro batch retry 7
```

Read `run.log` and the ledger before retrying: a partial run may already have created proposals or PRs. Retry reuses the same manifest and batch number; it does not automatically repeat runs. Active and completed attempts are refused. If a supervisor died, inspect its processes first, then use `batch retry <n> --recover-stale`; recovery refuses a supervisor that is still alive or whose state cannot be determined. Historical batches without status are unverified and require the same explicit inspection and recovery flag.

Detached Pi launches from an enforced ac-teams sandbox are refused, preserving the queue and manifest. The sandbox's access and proxy lifetime belong to its parent; agentic-retro never escapes it or removes access restrictions. Inspect the failure and start recovery later from an authorized independent context with the required access.

Claude Code, Codex, and herdr retain their existing launch behavior; this lifecycle protocol applies only to supervised Pi runs.

## State

- Runtime state lives under `~/.agentic-retro/` (override with `AGENTIC_RETRO_HOME`): config, queue, ledger, metrics, batch digests, reports, and compact candidate events
- Unresolved candidates carry forward without age expiry. Repo-local evidence stays scoped to its owner; agent-setup evidence may cross repos only for the same explicitly shared owner and specific change. Raw transcript grouping is unchanged
- Candidate events preserve source batch/session/repo/transcript/line and speaker attribution. Reviews must recheck original evidence, current code, and prior proposal decisions; missing sources remain unverified. Recurrence thresholds are unchanged
- Immutable candidate events merge repeated evidence and retain terminal dispositions despite stale concurrent writes. Input/retrieval safety limits fail visibly without deleting or silently truncating unresolved evidence
- Repository activation lives in Git's shared local configuration and never enters the tracked checkout
- Keep runtime state outside repositories; Git ignores its own metadata automatically

## Working on agentic-retro

Run the tests with `npm test`. The package regression test packs and extracts the real tarball, then exercises capture and notices without a global CLI. To also test native Codex npm installation and hook discovery (requires `codex` on PATH), run `AGENTIC_RETRO_TEST_CODEX=1 node --test test/plugin-package.test.js`. It uses isolated homes and a local tarball in place of the registry download; it makes no model calls.

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
