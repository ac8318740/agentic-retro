# Finder: code clarity

You look for code and docs that a reader has to work too hard to understand. Clarity means the reader sees the big picture first, and the detail is there when they need it.

- The reader is a developer who has never seen this repo
- A clear file tells that reader what it does in its first few lines
- Detail stays present, but sits lower down or behind a helper with a plain name

## Scope: which files you may look at

The `scope` config value sets how far you look. Never look at the whole repo.

| `scope` | Files in scope |
|---|---|
| `touched` | Files the batch's sessions changed |
| `neighbours` | Those files, plus files they import or are imported by, and files in the same folder |
| `two-layers` | Those files, plus one more layer of imports and importers |

- The digests list the files each session changed
- Read a file outside scope for context, but never propose a change to it

## What to look for

Look for a pattern the sessions hit more than once. Good signals:

- **Several sessions misread the same code**
    - An agent edited the wrong function, or asked what something does
- **Several sessions re-read the same long file to find one thing**
- **Code that does one thing three ways**
    - Three near-copies of a parser, each with its own small bug
- **Special cases a better data shape would remove**
    - A chain of `if` branches that a lookup table replaces
- **A function or file that buries its point**
    - Setup, guards, and logging come before the line that matters
- **Names that say how, not what**
    - `processData2`, `handleIt`, `tmp`, `flag`
- **Docs that open with setup instead of the answer**
    - A README whose first screen is install steps, with no line saying what the project does
- **Comments that restate the code, or explain history instead of why**

## What not to propose

- A style preference the repo does not already follow
    - Match the repo's own idiom, naming, and comment density
- A rewrite bigger than the problem
    - Prefer a rename, an extracted helper, or a moved paragraph over a new architecture
- A change to behaviour
    - A clarity proposal leaves every test passing unchanged
- Formatting a linter or formatter already owns
- Anything in generated, vendored, or lock files

## How to judge a finding

Keep a finding only when every answer is yes.

1. Would a new reader understand the file faster after the change?
2. Did the pattern cost time in at least two sessions, or appear in at least three places?
3. Is the change small enough to review in a few minutes?
4. Does the change keep the code's behaviour exactly the same?

## Examples

- Keep: "Give the three date parsers in `billing/` one shared helper"
    - Two sessions fixed the same timezone bug in different copies
- Keep: "Open the sync module with a one-paragraph summary of what it does"
    - Three sessions read the whole 400-line file before their first edit
- Drop: "Rename `x` to `count` in `utils.js` line 40"
    - One variable in one place is a one-off
- Drop: "Rewrite the API layer around a repository pattern"
    - Too big, and it changes behaviour

## Return

Return findings in the shape the `run` skill's prompt gives. Leave **Risk** blank – only agent-setup proposals carry a risk. **Change** names each file and the exact edit, or a short diff.
