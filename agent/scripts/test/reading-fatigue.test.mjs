import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (relative) => readFile(new URL(relative, root), "utf8");

async function alwaysOnSkills() {
  const categories = await readdir(new URL("skills/", root), { withFileTypes: true });
  const skills = [];

  for (const category of categories.filter((entry) => entry.isDirectory())) {
    const entries = await readdir(new URL(`skills/${category.name}/`, root), { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const content = await read(`skills/${category.name}/${entry.name}/SKILL.md`);
      if (/^injection: always$/m.test(content)) skills.push(entry.name);
    }
  }

  return skills.sort();
}

test("only compact universal guidance is injected on every turn", async () => {
  assert.deepEqual(await alwaysOnSkills(), ["concise-output", "core", "safety"]);
});

test("concise output favors readable grammar over minimum token count", async () => {
  const content = await read("skills/standards/concise-output/SKILL.md");

  assert.match(content, /reads incrementally/i);
  assert.match(content, /removing repetition/i);
  assert.match(content, /connective, causal, or disambiguating words/i);
  assert.match(content, /three or more modifying nouns/i);
  assert.match(content, /“that” and “which”/);
  assert.doesNotMatch(content, /shortest version|signal-to-ink|Tufte|chartjunk|slop grenades|Low-Entropy/i);
});

test("technical English keeps clarity rules contextual rather than mechanical", async () => {
  const content = await read("skills/standards/technical-english/SKILL.md");

  assert.doesNotMatch(content, /Aim for ≤20 words|≤25 in descriptions/);
  assert.doesNotMatch(content, /The em-dash is the loudest/);
  assert.match(content, /established domain term/i);
  assert.match(content, /subject and verb/i);
});

test("daily display defaults hide incidental transcript noise", async () => {
  const settings = JSON.parse(await read("settings.json"));

  assert.equal(settings.hideThinkingBlock, true);
  assert.equal(settings.quietStartup, "header");
  assert.equal(settings.fullscreenExitOutput, "resume-hint");
  assert.equal(settings.treeFilterMode, "no-tools");
});

test("pi ask injects one compact selection rule", async () => {
  const content = await read("extensions/pi-ask.ts");
  const match = content.match(/function buildSystemPrompt[\s\S]*?^}/m)?.[0] ?? "";

  assert.match(match, /When the user must choose among two or more paths/);
  assert.doesNotMatch(match, /Self-check before sending|tradeoff menus|inline detail help text/);
});

test("implementation and review agents avoid forced recaps and empty sections", async () => {
  const [builder, ralph, reviewer] = await Promise.all([
    read("subagents/builder.md"),
    read("subagents/ralph-implementer.md"),
    read("subagents/reviewer.md"),
  ]);

  assert.doesNotMatch(builder, /Objective recap|restating the implementation objective/i);
  assert.doesNotMatch(ralph, /Objective recap/);
  assert.match(reviewer, /include a section only when/i);
});
