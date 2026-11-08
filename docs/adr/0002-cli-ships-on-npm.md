# The CLI ships on npm, not inside the plugin

Historical decision, superseded in 0.1.10: the npm package now includes the plugin manifests and hooks, and every plugin install executes its package-local CLI. Relative paths from hooks and skills avoid host-specific cache lookup or global symlinks. A global CLI remains optional for terminal use.

The plugin holds only the hooks and the skills. The `agentic-retro` command line tool installs separately with `npm install -g agentic-retro`. If the command is missing, the hooks print the install line and exit 0.

## Considered options

Bundling the CLI in the plugin means one install. It also needs a shim that finds the right copy in each harness's plugin cache, and maintaining such a shim is painful. Claude Code, Codex, and Pi each cache plugins differently.

## Consequences

Users install two things. The npm package also ships `skills/`, so Pi can load the `run` skill from the installed package.
