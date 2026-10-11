// Turns Codex tool records into tool calls and edits, for both transcript formats.
// Legacy: function_call "shell" with a command array. Current (0.162+): custom_tool_call "exec" whose input is a JS script.

// Counts +/- lines per file in an apply_patch body ("*** Update File: x" headers).
function patchEdits(patch) {
  const edits = [];
  let current = null;
  for (const line of patch.split('\n')) {
    const header = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (header) edits.push((current = { file: header[1].trim(), added: 0, removed: 0 }));
    else if (!current || line.startsWith('***')) continue;
    else if (line.startsWith('+') && !line.startsWith('+++')) current.added++;
    else if (line.startsWith('-') && !line.startsWith('---')) current.removed++;
  }
  return edits;
}

function parse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function patchCall(patch) {
  const edits = patchEdits(patch);
  return { call: { tool: 'apply_patch', target: edits.map((e) => e.file).join(', '), error: null }, edits };
}

// Returns the patch text from ["apply_patch", patch] or ["bash", "-lc", "apply_patch <<'EOF' ... EOF"].
function patchOf(command) {
  if (command[0] === 'apply_patch') return command[1] ?? '';
  const script = command.at(-1) ?? '';
  return /^\s*apply_patch\b/.test(script) ? script : null;
}

function legacyShell(name, args) {
  const command = Array.isArray(args.command) ? args.command : [String(args.command ?? '')];
  const patch = patchOf(command);
  if (patch !== null) return [patchCall(patch)];
  const target = command.length > 2 && command[1] === '-lc' ? command[2] : command.join(' ');
  return [{ call: { tool: name, target, error: null }, edits: [] }];
}

// A JS string literal body like `npm test` or `*** Begin Patch\n...`, unescaped.
const STRING = '"((?:[^"\\\\]|\\\\.)*)"';
const SCRIPT_CALLS = new RegExp(`tools\\.(?:exec_command\\(\\{\\s*cmd\\s*:\\s*${STRING}|apply_patch\\(\\s*${STRING})`, 'g');

// One script can run several tools; each becomes its own call. Unknown scripts show as themselves.
function execScript(script) {
  const found = [...script.matchAll(SCRIPT_CALLS)].map(([, cmd, patch]) =>
    cmd !== undefined
      ? { call: { tool: 'exec', target: parse(`"${cmd}"`) ?? cmd, error: null }, edits: [] }
      : patchCall(parse(`"${patch}"`) ?? ''));
  return found.length ? found : [{ call: { tool: 'exec', target: script, error: null }, edits: [] }];
}

// Returns [{call, edits}] for a tool record, or null when the record is not a tool call.
export function toolCalls(p) {
  const plain = (target) => [{ call: { tool: p.name, target: String(target ?? ''), error: null }, edits: [] }];
  if (p.type === 'custom_tool_call') return p.name === 'exec' ? execScript(String(p.input ?? '')) : plain(p.input);
  if (p.type !== 'function_call') return null;
  const args = parse(p.arguments) ?? {};
  if (p.name === 'spawn_agent') return plain(args.task_name);
  return legacyShell(p.name, args.command === undefined ? { command: p.arguments ?? '' } : args);
}

// Returns "exit N: output" for a failed command, or null.
export function failure(p) {
  if (p.type === 'function_call_output') {
    const result = parse(p.output);
    const code = result?.metadata?.exit_code;
    return code ? `exit ${code}: ${result.output ?? ''}` : null;
  }
  if (p.type !== 'custom_tool_call_output') return null;
  const texts = Array.isArray(p.output) ? p.output.map((o) => o.text ?? '') : [String(p.output ?? '')];
  const result = texts.map((t) => parse(t)).find((r) => r && 'exit_code' in r);
  return result?.exit_code ? `exit ${result.exit_code}: ${result.output ?? ''}` : null;
}
