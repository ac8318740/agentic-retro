# One commit per proposal, matched by ID

In PR mode, each proposal is its own commit, and the commit headline starts with the proposal's ID (e.g. `P12: shorten the map skill`). `agentic-retro sync` reads the commits of each merged PR. A proposal whose ID is still there counts as accepted, and one whose commit was dropped counts as rejected.

## Considered options

One commit per PR is easier to read in history, but then a PR has only one outcome. You couldn't keep three proposals and drop the fourth. Asking the user to mark each proposal by hand gives exact outcomes, but nobody does it.

## Consequences

The batch agent must run `propose` before it commits, so the ID exists for the headline. It then runs `link` once the PR exists. A PR closed without merging rejects every proposal in it.
