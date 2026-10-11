// agentic-retro Pi extension, written by `agentic-retro install-pi`.
// Queues each finished session for a retro and shows new proposals at session start.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", (event, ctx) => {
    if (event.reason !== "quit") return; // "new", "resume", and "fork" only switch sessions
    if (process.env.AGENTIC_RETRO_RUN === "1") return; // batch agents never queue themselves

    const transcript = ctx.sessionManager.getSessionFile();
    if (!transcript) return; // nothing was said, so nothing was saved

    const child = spawn("agentic-retro", [
      "enqueue", "--harness", "pi",
      "--session", ctx.sessionManager.getSessionId(),
      "--transcript", transcript,
      "--cwd", ctx.cwd,
    ], { detached: true, stdio: "ignore" });
    child.on("error", () => {}); // CLI not installed: never break Pi
    child.unref();
  });

  pi.on("session_start", (_event, ctx) => {
    execFile("agentic-retro", ["notice"], (error, stdout) => {
      const line = stdout?.trim();
      if (!error && line) ctx.ui.notify(line, "info");
    });
  });
}
