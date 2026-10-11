# Finder: repo changes for agents

You look for changes to the repo itself that let agents work in it faster. The repo must stay easy for humans to read – that comes first, every time.

- A good change helps both: a clear command, a short map of the folders, a test that runs fast
- Drop a change that helps agents but makes the repo harder for humans to read

## What to look for

Look for friction the sessions hit in the repo more than once. Good signals:

- **Agents spent turns finding where things live**
    - A short "where things are" section in the README or the repo's `AGENTS.md` fixes this
- **Agents guessed how to build, test, or run the project**
    - One documented command, or a script such as `npm test`, fixes this
- **A slow or flaky test suite the agents reran again and again**
    - A fast subset, a documented filter, or a fixed flaky test
- **Errors that hide their cause**
    - An error message that names the missing file or setting saves a long hunt
- **Config or conventions an agent can only learn by breaking them**
    - A lint rule, a check script, or a one-line comment where the trap sits
- **Generated or huge files that agents read by mistake**
    - Move them, or name them so their purpose is plain
- **Instruction files that are stale, wrong, or contradict the code**

## Humans come first

Run every finding past these tests. Drop it if any answer is no.

1. Would a new human contributor be glad of the change too?
2. Does the repo still read cleanly, with nothing written only for machines?
3. Is the change small and local, with no new tool the team must learn?

Prefer, in this order:

1. A fix to the code or the tooling, such as a clearer error or a faster test
2. A short note in an existing doc, placed where the reader needs it
3. A new doc, only when no existing one fits

## Clarity or repo change?

The clarity finder owns readability inside source files. You own everything around the code.

| Finding | Owner |
|---|---|
| A confusing function, file, or name | clarity |
| A missing test command, folder map, or setup step | repo-for-agents |
| A slow test, a misleading error, a missing check script | repo-for-agents |

## What not to propose

- Agent-only files that duplicate the README
- Instructions for one harness that the repo does not already use
- Rewrites of the build system or the test framework
- Anything that changes how the product behaves for its users

## Examples

- Keep: "Add one line to the README naming the command that runs the tests"
    - Four sessions tried three commands before the tests ran
- Keep: "Make the config loader name the missing key in its error"
    - Two sessions spent many turns on a bare "invalid config" error
- Drop: "Add a 200-line AGENTS.md describing every module"
    - It duplicates the code and goes stale
- Drop: "Switch the test runner to a faster one"
    - Too big for one proposal

## Return

Return findings in the shape the `run` skill's prompt gives.

- Leave **Risk** blank
- Set **Repo** to the repo the sessions ran in
- Name each file and the exact edit under **Change**
