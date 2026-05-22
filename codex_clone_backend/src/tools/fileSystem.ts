import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { glob } from "glob";

export const WORKING_DIR = path.resolve(
  process.cwd(),
  "public/working-dir/human-in-loop",
);

const IGNORED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".nuxt",
  "out",
  ".turbo",
  ".vercel",
  ".next",
  ".cache",
  "__pycache__",
];

/*
 * Resolve a Retrieve path safety - prevent path traversal attacks by ensuring the resolved path is within the working directory.
 */
export function safePath(filePath: string) {
  const resolvedPath = path.resolve(WORKING_DIR, filePath);

  if (!resolvedPath.startsWith(WORKING_DIR)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  return resolvedPath;
}

// --------------------------------------------------------
// File Read
// --------------------------------------------------------
export const readFileTool = tool(
  async ({ file_path, start_line, end_line }) => {
    try {
      const safeFilePath = safePath(file_path);
      const content = await fs.readFile(safeFilePath, "utf-8");
      const lines = content.split("\n");

      const start = start_line ? Math.max(start_line - 1, 0) : 0;
      const end = end_line ? Math.min(end_line, lines.length) : lines.length;
      const selectedContent = lines.slice(start, end);

      const numberedLines = selectedContent
        .map((line, index) => `${start + index + 1}: ${line}`)
        .join("\n");
      const rangeInfo =
        start_line || end_line ? ` (lines ${start + 1}-${end})` : "";

      return `Content of ${file_path}${rangeInfo}:\n\n${numberedLines}`;
    } catch (error) {
      return `Error reading file ${file_path}: ${(error as Error).message}`;
    }
  },
  {
    name: "read_file",
    description: "Read the content of a file in the working directory.",
    schema: z.object({
      file_path: z.string().describe("Relative path of the file to read."),
      start_line: z
        .number()
        .optional()
        .describe("Starting line number (1-based) to read from."),
      end_line: z
        .number()
        .optional()
        .describe("Ending line number (1-based) to read to."),
    }),
  },
);

// --------------------------------------------------------
// Write File
// --------------------------------------------------------
export const writeFileTool = tool(
  async ({ file_path, content }) => {
    try {
      const fullPath = safePath(file_path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      const lineCount = content.split("\n").length;

      return `Successfully wrote to ${file_path} (${lineCount} lines).`;
    } catch (err: unknown) {
      return `Error writting file: ${err instanceof Error ? err.message : "Unknown error"}`;
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the working directory.",
    schema: z.object({
      file_path: z.string().describe("Relative path of the file to write."),
      content: z.string().describe("Content to write to the file."),
    }),
  },
);

// --------------------------------------------------------
// Edit File (str_replace approach like claude code)
// --------------------------------------------------------
export const editFileTool = tool(
  async ({ file_path, old_str, new_str }) => {
    try {
      const fullPath = safePath(file_path);
      const content = await fs.readFile(fullPath, "utf-8");

      const occurrences = content.split(old_str).length - 1;

      if (occurrences === 0) {
        return `String "${old_str}" not found in ${file_path}. No changes made.`;
      }

      if (occurrences > 1) {
        return `String "${old_str}" found ${occurrences} times in ${file_path}. Please confirm replacement.`;
      }

      const updatedContent = content.replace(old_str, new_str);

      await fs.writeFile(fullPath, updatedContent, "utf-8");

      const removed = old_str.split("\n").length - 1;
      const added = new_str.split("\n").length - 1;

      return `Successfully replaced "${old_str}" with "${new_str}" in ${file_path}. Lines removed: ${removed}, lines added: ${added}.`;
    } catch (error) {
      return `Error editing file ${file_path}: ${(error as Error).message}`;
    }
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing an old string with a new string.",
    schema: z.object({
      file_path: z.string().describe("Relative path of the file to edit."),
      old_str: z.string().describe("The string to be replaced."),
      new_str: z.string().describe("The string to replace with."),
    }),
  },
);

// --------------------------------------------------------
// file_tree
// --------------------------------------------------------
export async function buildTree(dirPath: string, prefix = ""): Promise<any> {
  let output = "";
  let entries;

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    return (
      output +
      ` Error reading directory ${dirPath}: ${(error as Error).message}\n`
    );
  }

  const visible = entries.filter(
    (entry) =>
      !IGNORED_DIRS.includes(entry.name) && !entry.name.startsWith("."),
  );

  visible.forEach((entry, index) => {
    const isLast = index === visible.length - 1;
    const marker = isLast ? "└── " : "├── ";
    output += `${prefix}${marker}${entry.name}\n`;

    if (entry.isDirectory()) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      output += buildTree(path.join(dirPath, entry.name), newPrefix);
    }
  });

  return output;
}

export const fileTreeTool = tool(
  async ({ directory }) => {
    try {
      const targetDir = directory ? safePath(directory) : WORKING_DIR;
      const label = directory || ".";
      const tree = await buildTree(targetDir);
      return `File tree of ${label}:\n\n${tree}`;
    } catch (error) {
      return `Error building file tree: ${(error as Error).message}`;
    }
  },
  {
    name: "file_tree",
    description:
      "Get a visual tree of the file structure in the working directory or a specified subdirectory.",
    schema: z.object({
      directory: z
        .string()
        .optional()
        .describe(
          "Relative path of the subdirectory to visualize (default is root).",
        ),
    }),
  },
);

// ----------------------------------------------------------------------
// list_dir
// ----------------------------------------------------------------------
export const listDirTool = tool(
  async ({ directory }) => {
    try {
      const fullPath = directory ? safePath(directory) : WORKING_DIR;
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      const lines = entries.map((entry) => {
        const type = entry.isDirectory() ? "dir" : "file";
        return `${type}: ${entry.name}`;
      });

      const label = directory || ".";

      return `Contents of ${label}:\n\n${lines.join("\n")}`;
    } catch (error) {
      return `Error listing directory: ${(error as Error).message}`;
    }
  },
  {
    name: "list_dir",
    description:
      "List files and directories in the working directory or a specified subdirectory.",
    schema: z.object({
      directory: z
        .string()
        .optional()
        .describe(
          "Relative path of the subdirectory to list (default is root).",
        ),
    }),
  },
);

// ----------------------------------------------------------------------
// ls_tool
// ----------------------------------------------------------------------
export const lsTool = tool(
  async ({ directory, pattern }) => {
    try {
      const base = directory ? safePath(directory) : WORKING_DIR;
      const files = await glob(pattern || "**/*", {
        nodir: true,
        cwd: base,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
        ],
      });

      if (files.length === 0)
        return `No files matching ${pattern || "*"} found in ${directory || "."}.`;

      return `Files in ${directory || "."} matching ${pattern || "*"}:\n\n${files.join("\n")}`;
    } catch (error) {
      return `Error occurred while searching for files: ${(error as Error).message}`;
    }
  },
  {
    name: "ls",
    description: "List files in a directory matching a glob pattern.",
    schema: z.object({
      directory: z
        .string()
        .optional()
        .describe(
          "Relative path of the directory to search (default is root).",
        ),
      pattern: z
        .string()
        .optional()
        .describe("Glob pattern to match files (default is '*')."),
    }),
  },
);

// --------------------------------------------------------
// search_file (grep-style cross-file search)
// --------------------------------------------------------
export const searchFileTool = tool(
  async ({ query, file_pattern, case_sensitive = false }) => {
    try {
      const files = await glob(file_pattern || "**/*.{js,jsx,ts,tsx}", {
        cwd: WORKING_DIR,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
        ],
        nodir: true,
      });

      const flags = case_sensitive ? "" : "i";
      const regex = new RegExp(query, `g${flags}`);
      const results = [];

      for (const file of files) {
        const fullPath = path.join(WORKING_DIR, file);
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const matches: any[] = [];

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });

        if (matches.length > 0) {
          results.push(
            `Found ${matches.length} matches in ${file}:\n${matches
              .map((m) => `  ${m}`)
              .join("\n")}`,
          );
        }
      }

      if (results.length === 0)
        return `No matches found for "${query}" in files matching "${file_pattern || "**/*.{js,jsx,ts,tsx}"}".`;

      return `Search results for "${query}" in files matching "${file_pattern || "**/*.{js,jsx,ts,tsx}"}":\n\n${results.join("\n")}`;
    } catch (error) {
      return `Error occurred while searching for files: ${(error as Error).message}`;
    }
  },
  {
    name: "search_file",
    description:
      "Search for a query string across files matching a glob pattern.",
    schema: z.object({
      query: z.string().describe("The string or regex pattern to search for."),
      file_pattern: z
        .string()
        .optional()
        .describe(
          'Glob pattern to match files (default is "**/*.{js,jsx,ts,tsx}").',
        ),
      case_sensitive: z
        .boolean()
        .optional()
        .describe(
          "Whether the search should be case sensitive (default is false).",
        ),
    }),
  },
);

export const fileSystemTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  fileTreeTool,
  listDirTool,
  lsTool,
  searchFileTool,
];
