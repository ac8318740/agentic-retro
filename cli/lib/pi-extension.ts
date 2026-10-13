// agentic-retro Pi extension, written by `agentic-retro install-pi`.
// Queues each finished session for a retro and shows new proposals at session start.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(PACKAGE_ROOT, "cli", "agentic-retro.js");
const SETUP_SKILL = join(PACKAGE_ROOT, "skills", "setup");
const RUN_SKILL = join(PACKAGE_ROOT, "skills", "run");
const REVIEW_SKILL = join(PACKAGE_ROOT, "skills", "review");
const RETRO_SKILL = join(PACKAGE_ROOT, "skills", "retro");

type CommandContext = {
  addUserMessage?: (message: string) => void;
  ui?: { notify: (message: string, level?: string) => void };
};

function argv(args: string) {
  const values = [];
  let current = "";
  let quote = "";
  let started = false;

  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];

    if (quote && char === "\\" && (args[i + 1] === quote || args[i + 1] === "\\")) {
      current += args[i + 1];
      started = true;
      i += 1;
    } else if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      started = true;
    } else if (/\s/.test(char) && !quote) {
      if (started) values.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }

  if (started) values.push(current);
  return values;
}

function sendUserMessage(pi: ExtensionAPI, ctx: CommandContext, message: string) {
  if (ctx.addUserMessage) return ctx.addUserMessage(message);
  return pi.sendUserMessage(message);
}

function skillPrompt(skill: string, args: string) {
  const request = args.trim();
  return `Use the agentic-retro skill at ${skill}.${request ? `\n\nUser request: ${request}` : ""}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("agentic-retro", {
    description: "Run the package-local agentic-retro CLI",
    handler: async (args, ctx) => {
      execFile(process.execPath, [CLI, ...argv(args)], (error, stdout, stderr) => {
        const output = (stdout || stderr).trim();
        if (output) ctx.ui.notify(output, error ? "error" : "info");
      });
    },
  });

  pi.registerCommand("agentic-retro:setup", {
    description: "Run the bundled agentic-retro setup skill",
    handler: async (args, ctx) => sendUserMessage(pi, ctx, skillPrompt(SETUP_SKILL, args)),
  });
  pi.registerCommand("agentic-retro:run", {
    description: "Run the bundled agentic-retro run skill",
    handler: async (args, ctx) => sendUserMessage(pi, ctx, skillPrompt(RUN_SKILL, args)),
  });
  pi.registerCommand("agentic-retro:review", {
    description: "Run the bundled agentic-retro review skill",
    handler: async (args, ctx) => sendUserMessage(pi, ctx, skillPrompt(REVIEW_SKILL, args)),
  });
  pi.registerCommand("agentic-retro:retro", {
    description: "Run the bundled agentic-retro retro skill",
    handler: async (args, ctx) => sendUserMessage(pi, ctx, skillPrompt(RETRO_SKILL, args)),
  });

  pi.on("session_shutdown", (event, ctx) => {
    if (event.reason !== "quit") return; // "new", "resume", and "fork" only switch sessions
    if (process.env.AGENTIC_RETRO_RUN === "1") return; // batch agents never queue themselves

    const transcript = ctx.sessionManager.getSessionFile();
    if (!transcript) return; // nothing was said, so nothing was saved

    const child = spawn(process.execPath, [
      CLI, "enqueue", "--harness", "pi",
      "--session", ctx.sessionManager.getSessionId(),
      "--transcript", transcript,
      "--cwd", ctx.cwd,
    ], { detached: true, stdio: "ignore" });
    child.on("error", () => {}); // CLI missing/broken: never break Pi
    child.unref();
  });

  pi.on("session_start", (_event, ctx) => {
    execFile(process.execPath, [CLI, "notice"], (error, stdout) => {
      const line = stdout?.trim();
      if (!error && line) ctx.ui.notify(line, "info");
    });
  });
}
