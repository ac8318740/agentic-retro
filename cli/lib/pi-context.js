// Remove identity, never access restrictions, from an independent Pi run.
const IDENTITY = [
  'AC_TEAMS_SOCKET', 'AC_TEAMS_MEMBER', 'AC_TEAMS_TOKEN', 'AC_TEAMS_TERMINAL_SOCKET',
  'ACSTACK_AGENT_ROLE', 'PI_SUBAGENT_CHILD', 'PI_SUBAGENTS_HERDR_BRIDGE',
  'PI_SESSION_ID', 'PI_SESSION_FILE', 'HERDR_ENV',
];

export function independentPiEnv(env = process.env) {
  if (env.AC_TEAMS_ACCESS) {
    let access;
    try { access = JSON.parse(env.AC_TEAMS_ACCESS); } catch {}
    if (!access || Array.isArray(access) || access.enforced !== false) {
      throw new Error('Detached Pi launch refused: enforced or malformed sandbox access. Recover from an authorized independent context; access restrictions were not removed.');
    }
  }
  const independent = { ...env };
  for (const key of IDENTITY) delete independent[key];
  return independent;
}
