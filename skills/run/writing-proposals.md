# Writing proposals

Someone who never saw the sessions reads every pull request (PR) and report this skill writes. Each proposal must make sense on its own, to anyone.

## Rules

- **Never mention transcripts, sessions, batches, or agents' past behaviour**
    - Write "Running the tests needs one documented command", never "Agents in 4 sessions guessed the test command"
    - The **Evidence** a finder returns is for the lead only, and never appears in a PR or report
- **Each proposal stands alone**
    - It never refers to another proposal, or to "the above"
- **Justify each proposal by why it makes things better**
    - Say what gets faster, clearer, or safer, for whom
- **Open very high level, in plain words**
    - A non-technical reader understands the first line
    - No jargon, no file paths, and no code before the details section
- **Put every detail in a collapsed `<details>` section**
    - Files, the exact change, and any reasoning a reviewer may want
- **Label risk only on agent-setup proposals**
    - Low risk adds something new; high risk edits something the user already has
- Write short sentences, one idea each, with no em dashes

## One proposal

Use the same block in a PR body and in a report.

```markdown
### P12: Name the test command in the README (repo changes)

Anyone new to the repo can run the tests on the first try.

<details>
<summary>Details</summary>

- **Why:** the README lists three scripts, and only one runs the full suite
- **Change:** add one line under "Development" in `README.md`

    ```diff
    + Run the tests with `npm test`.
    ```

</details>
```

- The heading holds the ID, the title, and the category in words
    - Categories in words: code clarity, agent setup, repo changes
    - Agent setup adds the risk: `(agent setup, low risk)`
- The line under the heading says what gets better, in one sentence
- The title is a plain verb phrase, under ten words
    - Write "Name the test command in the README", never "Docs improvement"

## PR body

One PR per repo. The PR title says what the PR does for the repo, such as `Clearer setup and two simpler modules`.

```markdown
Three small changes that make this repo quicker to work in.

- **P12:** Name the test command in the README
- **P13:** Give the three date parsers one shared helper
- **P14:** Add a skill that runs the release steps

Each change is its own commit. Drop a commit to turn down that one change.

<one proposal block per proposal, in the order above>
```

- The first line sums up the whole PR
- The list gives each ID and title, so a reviewer sees everything in seconds
- Commits map one to one with proposals, so dropping a commit rejects one proposal

## Report file

One file per batch, at `reports/<n>.md` under the state folder (`$AGENTIC_RETRO_HOME`, default `~/.agentic-retro`). Group by repo, then by category.

```markdown
# Proposals from batch 7

Three proposals across two repos.

## ~/code/shop

### Code clarity

<one proposal block>

### Repo changes

<one proposal block>

## ~/.claude/skills

### Agent setup

<one proposal block>
```

- The `review` skill walks the file one item at a time and applies each yes
- Each item's details must hold enough to apply the change with no other context
    - The full text of a new file, or the exact edit to an existing one
- Order categories the same way in every repo: code clarity, agent setup, repo changes
