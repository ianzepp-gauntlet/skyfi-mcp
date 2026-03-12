import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const mode = process.argv.includes("--write") ? "write" : "check";
const repoRoot = process.cwd();

const languageByExtension = {
  ".json": "json",
  ".py": "python",
  ".sh": "bash",
  ".ts": "typescript",
};

const tempDir = mkdtempSync(path.join(os.tmpdir(), "skyfi-doc-examples-"));

function codeFenceFor(filePath, source) {
  const ext = path.extname(filePath);
  const language = languageByExtension[ext];
  if (!language) {
    throw new Error(`Unsupported example extension for ${filePath}`);
  }
  return `\`\`\`${language}\n${source.trimEnd()}\n\`\`\``;
}

async function syncDoc(docPath) {
  const absoluteDocPath = path.join(repoRoot, docPath);
  const original = await fs.readFile(absoluteDocPath, "utf8");
  const marker = /<!-- example: ([^ ]+) -->\n[\s\S]*?\n<!-- \/example -->/g;
  const examplePaths = [];

  const updated = await replaceAsync(
    original,
    marker,
    async (match, relPath) => {
      const absoluteExamplePath = path.join(repoRoot, relPath);
      const source = await fs.readFile(absoluteExamplePath, "utf8");
      examplePaths.push(relPath);
      return [
        `<!-- example: ${relPath} -->`,
        "",
        codeFenceFor(relPath, source),
        "",
        "<!-- /example -->",
      ].join("\n");
    },
  );

  if (updated !== original) {
    if (mode === "write") {
      await fs.writeFile(absoluteDocPath, updated);
    } else {
      throw new Error(
        `${docPath} is out of sync with checked-in examples. Run: node scripts/verify-doc-examples.mjs --write`,
      );
    }
  }

  return examplePaths;
}

async function replaceAsync(input, pattern, replacer) {
  const matches = [...input.matchAll(pattern)];
  if (matches.length === 0) return input;

  let cursor = 0;
  let output = "";

  for (const match of matches) {
    const [fullMatch] = match;
    const index = match.index ?? 0;
    output += input.slice(cursor, index);
    output += await replacer(...match);
    cursor = index + fullMatch.length;
  }

  output += input.slice(cursor);
  return output;
}

function verifyTypeScript(filePath) {
  const outFile = path.join(
    tempDir,
    `${path.basename(filePath, ".ts")}-${Date.now()}.mjs`,
  );
  execFileSync(
    "bun",
    [
      "x",
      "esbuild",
      filePath,
      "--format=esm",
      "--platform=node",
      "--log-level=error",
      `--outfile=${outFile}`,
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
}

function verifyPython(filePath) {
  execFileSync("python3", ["-m", "py_compile", filePath], {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

function verifyExample(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".ts") {
    verifyTypeScript(filePath);
    return;
  }
  if (ext === ".py") {
    verifyPython(filePath);
    return;
  }
  throw new Error(`No verifier configured for ${filePath}`);
}

async function main() {
  const docs = [
    "docs/integrations/openai.md",
    "docs/integrations/langchain.md",
  ];

  const examplePaths = new Set();
  for (const docPath of docs) {
    for (const examplePath of await syncDoc(docPath)) {
      examplePaths.add(examplePath);
    }
  }

  for (const examplePath of [...examplePaths].sort()) {
    verifyExample(examplePath);
  }

  console.log(
    `${mode === "write" ? "Synced" : "Verified"} ${docs.length} docs and ${examplePaths.size} example files.`,
  );
}

try {
  await main();
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
