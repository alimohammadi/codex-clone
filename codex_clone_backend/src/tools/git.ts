import { tool } from "@langchain/core/tools";
import { z } from "zod";
import simpleGit from "simple-git";
import path from "path";

const WORKING_DIR = path.join(
  process.cwd(),
  "public/working-dir/human-in-loop",
);

function getGit() {
  return simpleGit(WORKING_DIR);
}

async function assertGitRepo(git: any) {
  const isRepo = await git.checkIsRepo().catch(() => false);

  if (!isRepo)
    throw new Error(
      `The directory ${WORKING_DIR} is not a git repository. Run "git init" first`,
    );
}

// --------------------------------------------------------
// Git Diff
// --------------------------------------------------------
export const gitDiffTool = tool(
  async ({ staged = false, file_path, target }) => {
    try {
      const git = getGit();
      await assertGitRepo(git);

      const args = [];
      if (staged) args.push("--staged");
      else if (target) args.push(target);
      else args.push("HEAD");

      if (file_path) args.push("--", file_path);

      const diff = await git.diff(args);
      if (diff.trim() === "") return "No changes found.";

      return `Git Diff${staged ? " (staged)" : ""}${target ? ` (target: ${target})` : ""}${file_path ? ` (file: ${file_path})` : ""}:\n\n${diff}`;
    } catch (error) {
      return `Error getting git diff: ${(error as Error).message}`;
    }
  },
  {
    name: "git_diff",
    description: "Get the git diff of the current working directory.",
    schema: z.object({
      staged: z
        .boolean()
        .optional()
        .describe("Whether to include staged changes (default false)."),
      file_path: z
        .string()
        .optional()
        .describe("Relative path of a specific file to diff."),
      target: z
        .string()
        .optional()
        .describe(
          "Git target to diff against (e.g., a commit hash or branch).",
        ),
    }),
  },
);

// --------------------------------------------------------
// Git Log
// --------------------------------------------------------
export const gitLogTool = tool(
  async ({ limit, author, since }) => {
    try {
      const git = getGit();
      await assertGitRepo(git);

      const options: Record<string, string | number> = {
        maxCount: limit ?? 10,
      };

      if (author) options["--author"] = author;
      if (since) options["--since"] = since;
      const log = await git.log(options);
      if (!log.all.length) return "No commits found.";

      const lines = log.all.map(
        (c) =>
          `${c.hash.slice(0, 7)} | ${c.date.slice(0, 10)} | ${c.author_name.padEnd(20)} | ${c.message}`,
      );

      return `Recent Git Commits:\n\n${lines.join("\n")}`;
    } catch (error) {
      return `Error getting git log: ${(error as Error).message}`;
    }
  },
  {
    name: "git_log",
    description: "Get the git commit history of the current working directory.",
    schema: z.object({
      limit: z
        .number()
        .optional()
        .describe("Maximum number of commits to return (default 10)."),
      author: z
        .string()
        .optional()
        .describe("Filter commits by this author name or email."),
      since: z
        .string()
        .optional()
        .describe(
          "Filter commits since this date (e.g., 2 weeks ago, 2025-01-01).",
        ),
    }),
  },
);

// --------------------------------------------------------
// Git Status
// --------------------------------------------------------
export const gitStatusTool = tool(
  async () => {
    try {
      const git = getGit();
      await assertGitRepo(git);

      const status = await git.status();
      const lines = [];

      if (status.staged.length)
        lines.push(`Staged:\n${status.staged.join(", ")}`);
      if (status.modified.length)
        lines.push(`Modified:\n${status.modified.join(", ")}`);
      if (status.not_added.length)
        lines.push(`Untracked:\n${status.not_added.join(", ")}`);
      if (status.deleted.length)
        lines.push(`Deleted:\n${status.deleted.join(", ")}`);
      if (status.conflicted.length)
        lines.push(`Conflicted:\n${status.conflicted.join(", ")}`);

      if (lines.length === 0)
        return "Git status: Clean. No changes. Nothing to commit.";

      return `Branch: ${status.current} \n\nGit Status:\n\n${lines.join("\n")}`;
    } catch (error) {
      return `Error getting git status: ${(error as Error).message}`;
    }
  },
  {
    name: "git_status",
    description: "Get the git status of the current working directory.",
    schema: z.object({}), 
  },
);


export const gitTools = [gitDiffTool, gitLogTool, gitStatusTool];

