import { constants } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
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
    const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) throw new Error("Scratch root is not a directory");
      // Pin the original inode: dev/ino alone can be recycled after deletion.
      this.#owned.set(root, { dev: stat.dev, ino: stat.ino, handle });
    } catch (error) {
      await handle.close();
      throw error;
    }
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
    } catch (error) {
      this.#owned.set(target, identity);
      throw error;
    }
    await identity.handle.close();
    return { path: target, removed: true };
  }

  async cleanupAll() {
    const removed = [];
    for (const target of [...this.#owned.keys()]) {
      try {
        await this.remove(target);
        removed.push(target);
      } catch {
        // End ownership even when shutdown refuses deletion; never leak the pin.
        const identity = this.#owned.get(target);
        this.#owned.delete(target);
        await identity?.handle.close();
      }
    }
    return removed;
  }
}
