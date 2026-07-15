import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InterceptorExtensionCore } from "../extension-core/interceptor-extension-core";

type HunkSession = {
  cwd?: string;
  repoRoot?: string;
};

type HunkSessionList = {
  sessions?: HunkSession[];
};

const HUNK_SKILL_NAME = "hunk-review";

function runCommand(command: string, args: string[], cwd?: string): string | undefined {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeExistingPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;

  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function currentRepoRoot(cwd: string): string {
  const gitRoot = runCommand("git", ["rev-parse", "--show-toplevel"], cwd);
  return normalizeExistingPath(gitRoot) ?? normalizeExistingPath(cwd) ?? cwd;
}

function activeHunkSessionFor(cwd: string): HunkSession | undefined {
  const output = runCommand("hunk", ["session", "list", "--json"]);
  if (!output) return undefined;

  let payload: HunkSessionList;
  try {
    payload = JSON.parse(output) as HunkSessionList;
  } catch {
    return undefined;
  }

  const normalizedCwd = normalizeExistingPath(cwd);
  const normalizedRepoRoot = currentRepoRoot(cwd);

  return payload.sessions?.find((session) => {
    const sessionCwd = normalizeExistingPath(session.cwd);
    const sessionRepoRoot = normalizeExistingPath(session.repoRoot);

    return (
      (sessionRepoRoot && sessionRepoRoot === normalizedRepoRoot) ||
      (sessionCwd && sessionCwd === normalizedCwd)
    );
  });
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
}

function bundledHunkSkillPath(eventSkills: Array<{ name?: string; filePath?: string }> | undefined): string | undefined {
  const loadedSkill = eventSkills?.find((skill) => skill.name === HUNK_SKILL_NAME && skill.filePath);
  if (loadedSkill?.filePath && existsSync(loadedSkill.filePath)) return loadedSkill.filePath;

  const commandPath = runCommand("hunk", ["skill", "path"]);
  if (commandPath && existsSync(commandPath)) return commandPath;

  return undefined;
}

function readBundledHunkSkill(eventSkills: Array<{ name?: string; filePath?: string }> | undefined): string | undefined {
  const skillPath = bundledHunkSkillPath(eventSkills);
  if (!skillPath) return undefined;

  try {
    return stripFrontmatter(readFileSync(skillPath, "utf8"));
  } catch {
    return undefined;
  }
}

class HunkSkillExtension extends InterceptorExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, {
      id: "hunk-skill",
      name: "Hunk Skill",
      summary: "Injects Hunk review guidance when this checkout has a live Hunk session",
    });
  }

  protected registerExtension(): void {
    this.pi.on("before_agent_start", async (event, ctx) => {
      const session = activeHunkSessionFor(ctx.cwd);
      if (!session) return;

      const skill = readBundledHunkSkill(event.systemPromptOptions.skills);
      if (!skill) return;

      const repo = session.repoRoot ?? ctx.cwd;
      return {
        systemPrompt: `${event.systemPrompt}\n\n## Hunk review session active\nA live Hunk review session is active for ${repo}. Follow the bundled Hunk skill guidance below when reviewing or navigating this changeset.\n\n### hunk-review\n${skill}`,
      };
    });
  }
}

export default function hunkSkill(pi: ExtensionAPI) {
  new HunkSkillExtension(pi).register();
}
