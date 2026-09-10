import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SCRATCH_PREFIX = "pi-agent-scratch-";

export class ScratchWorkspaceRegistry {
  #owned = new Map();

  constructor({ tempRoot = os.tmpdir() } = {}) {
    this.tempRoot = path.resolve(tempRoot);
  }

  async create() {
    const root = await mkdtemp(path.join(this.tempRoot, SCRATCH_PREFIX));
    const stat = await lstat(root);
    this.#owned.set(root, { dev: stat.dev, ino: stat.ino });
    return { path: root };
  }

  async remove(rawPath) {
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
      throw new Error("scratch_workspace remove requires a path");
    }

    const target = path.resolve(rawPath.replace(/^@/, ""));
    const identity = this.#owned.get(target);
    if (!identity) throw new Error(`Refusing to remove ${target}: not an owned scratch root`);
    this.#owned.delete(target);

    try {
      const relative = path.relative(this.tempRoot, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(target).startsWith(SCRATCH_PREFIX)) {
        throw new Error(`Refusing to remove ${target}: outside the scratch root contract`);
      }

      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to remove ${target}: owned root was replaced by a symlink`);
      if (!stat.isDirectory()) throw new Error(`Refusing to remove ${target}: owned root is not a directory`);
      if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
        throw new Error(`Refusing to remove ${target}: owned root filesystem identity changed`);
      }

      // This rejects deterministic replacement, but recursive path deletion cannot
      // eliminate a same-user replacement race after the identity check.
      await rm(target, { recursive: true, force: false });
      return { path: target, removed: true };
    } catch (error) {
      this.#owned.set(target, identity);
      throw error;
    }
  }

  async cleanupAll() {
    const removed = [];
    for (const target of [...this.#owned.keys()]) {
      try {
        await this.remove(target);
        removed.push(target);
      } catch {
        // Never broaden shutdown cleanup beyond roots that still satisfy ownership checks.
      }
    }
    return removed;
  }
}
