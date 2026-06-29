#!/usr/bin/env node
import { lstat, mkdir, readdir, readlink, symlink, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sourceRoot = path.join(packageRoot, "agent", "subagents");
const piAgentDir = path.resolve(
  process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent"),
);
const agentsDir = path.join(piAgentDir, "agents");
const chainsDir = path.join(piAgentDir, "chains");

const linked = [];
const skipped = [];

await bootstrap();

async function bootstrap() {
  await ensurePiSubagentsManifestPath();
  await Promise.all([mkdir(agentsDir, { recursive: true }), mkdir(chainsDir, { recursive: true })]);

  for await (const sourcePath of subagentFiles(sourceRoot)) {
    const relativePath = path.relative(sourceRoot, sourcePath);
    const targetRoot = sourcePath.endsWith(".chain.md") ? chainsDir : agentsDir;
    const targetPath = path.join(targetRoot, relativePath);
    await linkFile(sourcePath, targetPath);
  }

  if (linked.length > 0) {
    console.log(`pi-agent: linked ${linked.length} subagent resource(s) into ${piAgentDir}`);
  }

  if (skipped.length > 0) {
    console.warn(`pi-agent: skipped ${skipped.length} existing non-symlink resource(s):`);
    for (const targetPath of skipped) console.warn(`  - ${targetPath}`);
  }
}

async function ensurePiSubagentsManifestPath() {
  const manifestPath = path.join(packageRoot, "node_modules", "pi-subagents");

  try {
    const stat = await lstat(manifestPath);
    if (!stat.isSymbolicLink()) return;

    const currentTarget = path.resolve(path.dirname(manifestPath), await readlink(manifestPath));
    const dependencyRoot = resolvePiSubagentsRoot();
    if (currentTarget === dependencyRoot) return;

    await unlink(manifestPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const dependencyRoot = resolvePiSubagentsRoot();
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await symlink(dependencyRoot, manifestPath, "dir");
}

function resolvePiSubagentsRoot() {
  return path.dirname(require.resolve("pi-subagents/package.json"));
}

async function* subagentFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* subagentFiles(entryPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") {
      continue;
    }

    yield entryPath;
  }
}

async function linkFile(sourcePath, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });

  try {
    const stat = await lstat(targetPath);

    if (!stat.isSymbolicLink()) {
      skipped.push(targetPath);
      return;
    }

    const currentTarget = path.resolve(path.dirname(targetPath), await readlink(targetPath));
    if (currentTarget === sourcePath) return;

    await unlink(targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await symlink(sourcePath, targetPath);
  linked.push(targetPath);
}
