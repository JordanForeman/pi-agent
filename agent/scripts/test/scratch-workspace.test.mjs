import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ScratchWorkspaceRegistry } from "../../extensions/scratch-workspace-core.mjs";

async function fixture(t) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "scratch-registry-test-"));
  const registry = new ScratchWorkspaceRegistry({ tempRoot });
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));
  return { registry, tempRoot };
}

test("creates an owned root directly beneath the configured temp directory", async (t) => {
  const { registry, tempRoot } = await fixture(t);
  const created = await registry.create();
  assert.equal(path.dirname(created.path), tempRoot);
  assert.match(path.basename(created.path), /^pi-agent-scratch-/);
  assert.equal((await lstat(created.path)).isDirectory(), true);
});

test("removes only an exact owned root and rejects arbitrary paths", async (t) => {
  const { registry, tempRoot } = await fixture(t);
  const created = await registry.create();
  await writeFile(path.join(created.path, "fixture.txt"), "temporary");
  await assert.rejects(registry.remove(tempRoot), /not an owned scratch root/);
  assert.deepEqual(await registry.remove(created.path), { path: created.path, removed: true });
  await assert.rejects(lstat(created.path), { code: "ENOENT" });
});

test("rejects an owned root replaced by a symlink or non-directory", async (t) => {
  const { registry, tempRoot } = await fixture(t);
  const external = path.join(tempRoot, "external");
  await mkdir(external);

  const linked = await registry.create();
  await rm(linked.path, { recursive: true });
  await symlink(external, linked.path);
  await assert.rejects(registry.remove(linked.path), /symlink/);
  await rm(linked.path);

  const file = await registry.create();
  await rm(file.path, { recursive: true });
  await writeFile(file.path, "replacement");
  await assert.rejects(registry.remove(file.path), /not a directory/);
});

test("rejects a replacement directory at the same pathname and preserves its contents", async (t) => {
  const { registry } = await fixture(t);
  const created = await registry.create();
  await rm(created.path, { recursive: true });
  await mkdir(created.path);
  const replacement = `${created.path}-replacement`;
  await mkdir(replacement);
  await rm(created.path, { recursive: true });
  await rename(replacement, created.path);
  const sentinel = path.join(created.path, "sentinel.txt");
  await writeFile(sentinel, "must survive");

  await assert.rejects(registry.remove(created.path), /filesystem identity changed/);
  assert.deepEqual(await registry.cleanupAll(), []);
  assert.equal((await lstat(created.path)).isDirectory(), true);
  assert.equal((await lstat(sentinel)).isFile(), true);
});

test("duplicate concurrent removal permits one owner and rejects the other", async (t) => {
  const { registry } = await fixture(t);
  const created = await registry.create();
  const results = await Promise.allSettled([registry.remove(created.path), registry.remove(created.path)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  await assert.rejects(lstat(created.path), { code: "ENOENT" });
});

test("cleanupAll removes every remaining owned root", async (t) => {
  const { registry } = await fixture(t);
  const roots = await Promise.all([registry.create(), registry.create()]);
  const cleaned = await registry.cleanupAll();
  assert.deepEqual(cleaned.sort(), roots.map((root) => root.path).sort());
  for (const root of roots) await assert.rejects(lstat(root.path), { code: "ENOENT" });
});
