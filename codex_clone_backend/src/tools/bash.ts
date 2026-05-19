import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

const WORKING_DIR = path.join(process.cwd(), "bash_tool_working_dir");
const MAX_OUTPUT_CHARS = 1000; // Maximum length of the command output
const CORE_FACTS = ["personal.name", "personal.location"];

const isWindows = process.platform === "win32";
const SHELL = isWindows ? "cmd.exe" : "/bin/bash";

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\!\w)/, // rm -rf /
  />\s*\/dev\//, // > /dev/
  /mkfs/, // mkfs
  /dd\s+if=/, // dd if=
  /:\(\)\s*\{.*\}/, // fork bomb
  /sudo\s+rm/, // sudo rm
  /shutdown|reboot|halt/, // shutdown/reboot/halt
  /curl\s+.*\|\s*(?:bash|sh|zsh)/, // curl | bash
  /wget\s+.*\|\s*(?:bash|sh|zsh)/, // wget | bash
  /\beval\b/, // eval
  /base64\s+.*\|\s*(?:bash|sh)/, // base64 | bash
  /(?:^|[;&|])\s*\/(?:etc|home|root|usr|var|sys|proc)\b/, // absolute system paths
];

const INTERACTIVE_PATTERNS = [
  /\brd\s+\/s(?!\s+\/q)/i, // rd /s without /q
  /\bnpm\s+init\b(?!.*-y)/i, // npm init without -y
  /\bapt(?:-get)?\s+install\b(?!.*-y)/i, // apt install without -y
  /\bgit\s+commit\b(?!.*-m)/i, // git commit without -m
  /\b(?:nano|vim?|vi|emacs|less|more)\b/i, // interactive editors
  /\b(?:python3?|node)\b(?!\s+\S+\.\\)/i, // interactive runtime
  /\bssh\b/i, // ssh
];

async function ensureWorkingDir() {
  await fs.promises.mkdir(WORKING_DIR, { recursive: true });
}

function normalizeCommand(command: string): string {
  if (isWindows) {
    if (/^rd\s+\/s\s+/i.test(command) && !/\/q/i.test(command))
      return command.replace(/rd\s+\/s/i, "rd /s /q");
  } else {
    if (/npm\s+init(?!.*-y)/.test(command)) return command + " -y";
    if (/apt(?:-get)?\s+install(?!.*-y)/.test(command))
      return command.replace(/install/, "install -y");
  }

  return command;
}

function truncateOut(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const half = MAX_OUTPUT_CHARS / 2;

  return (
    output.slice(0, half) +
    `\n\n... [truncated ${output.length - MAX_OUTPUT_CHARS} chars] ...\n\n` +
    output.slice(-half)
  );
}

export const bashTool = tool(
  async ({ command, timeout }) => {
    await ensureWorkingDir(); // lazy init

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return `Blocked dengerous command: "${command}"`;
      }
    }

    for (const pattern of INTERACTIVE_PATTERNS) {
      if (pattern.test(command)) {
        const fixed = normalizeCommand(command);

        if (fixed !== command) {
          command = fixed;
        }

        return `Interactive command detected (may hang): "${command}". Add no-interactive flags.`;
      }
    }

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: WORKING_DIR,
        shell: SHELL,
        timeout: Math.min(Math.max(timeout ?? 20, 5), 120) * 1000, // min enforced
        maxBuffer: 1024 * 1024 * 2, // Reduced to 2 MB
      });

      const out = [];
      if (stdout?.trim()) out.push(`STDOUT:\n${truncateOut(stdout.trim())}\n`);
      if (stderr?.trim()) out.push(`STDERR:\n${truncateOut(stderr.trim())}\n`);

      const result =
        out.length > 0
          ? out.join("\n")
          : "Command executed successfully with no output.";

      return result;
    } catch (error: any) {
      if (error.killed || error.signal === "SIGTERM") {
        return `Command timed out: "${command}"`;
      }

      const sanitizedError = error.message.replace(
        new RegExp(WORKING_DIR.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"),
        "[WORKING_DIR]",
      );

      const msg = [sanitizedError];

      if (error.stdout)
        msg.push(`STDOUT:\n${truncateOut(error.stdout.trim())}`);
      if (error.stderr)
        msg.push(`STDERR:\n${truncateOut(error.stderr.trim())}`);

      const result = `command failed: "${command}"\n\n${msg.join("\n\n")}`;
      return result;
    }
  },
  {
    name: "bash",
    description: "Execute bash commands in a safe, sandboxed environment.",
    schema: z.object({
      command: z.string().min(1).max(2000).describe("The bash command to execute."),
      timeout: z
        .number()
        .min(5).max(120)
        .optional()
        .describe(
          "Maximum execution time in seconds (default 20s, min 5s, max 120s).",
        ),
    }),
  },
);



// Test the tool with a sample command
if (require.main === module) {
  bashTool
    .invoke({ command: 'echo "bash tool test"' })
    .then(console.log)
    .catch((err) => console.error(err));
}

