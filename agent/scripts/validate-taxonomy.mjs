#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter, extractBody } from "./lib/frontmatter.mjs";
import {
  capabilitiesForTools,
  validateAgentContent,
  validateBuildWorkflowConfig,
  validateClassifierDocumentation,
  validatePromptContent,
  validateSettingsPromptPaths,
  validateSkillCategoryCounts,
  validateWorkflowSource,
  validateWorkflowTaskSpecs,
} from "./lib/semantic-validation.mjs";

const repoRoot = process.cwd();
const agentRoot = await pathExists(path.join(repoRoot, "agent"))
  ? path.join(repoRoot, "agent")
  : path.join(repoRoot, "pi", "agent");
const promptsRoot = path.join(agentRoot, "prompts");
const skillsRoot = path.join(agentRoot, "skills");
const subagentsRoot = path.join(agentRoot, "subagents");
const extensionsRoot = path.join(agentRoot, "extensions");
const extensionCoreRoot = path.join(agentRoot, "extension-core");
const optionalExtensionsRoot = path.join(agentRoot, "optional-extensions");
const legacyPhilosophyRoot = path.join(agentRoot, "philosophy");
const legacyFragmentsRoot = path.join(agentRoot, "system-fragments");
const legacyOrchestrationsRoot = path.join(agentRoot, "subagents", "orchestrations");

const PROMPT_CATEGORIES = ["ship", "analyze", "plan", "learn"];
const SKILL_CATEGORIES = ["guides", "conventions", "formats", "standards"];
const VALID_INJECTION_TYPES = ["always", "detect", "classify", "explicit"];
const EXTENSION_BASE_CLASSES = [
  "GuardianExtensionCore",
  "InterceptorExtensionCore",
  "WorkflowExtensionCore",
  "WidgetExtensionCore",
  "IntegrationExtensionCore",
];

const errors = [];

function toPosix(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dirPath, entry.name));
}

async function listDirs(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name));
}


async function validateNoLegacyDirectories() {
  for (const legacyDir of [legacyPhilosophyRoot, legacyFragmentsRoot]) {
    if (!(await pathExists(legacyDir))) continue;
    const entries = await fs.readdir(legacyDir, { withFileTypes: true });
    if (entries.length > 0) {
      errors.push(
        `Legacy directory should not be used: ${toPosix(legacyDir)} (content belongs in skills taxonomy)`
      );
    }
  }

  // Guard against legacy orchestration JSON directory
  if (await pathExists(legacyOrchestrationsRoot)) {
    const entries = await fs.readdir(legacyOrchestrationsRoot, { withFileTypes: true });
    const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
    if (jsonFiles.length > 0) {
      errors.push(
        `Legacy orchestration JSONs should be migrated to workflow extensions: ${toPosix(legacyOrchestrationsRoot)} (${jsonFiles.length} JSON files found)`
      );
    }
  }
}

async function validatePromptTaxonomy() {
  for (const category of PROMPT_CATEGORIES) {
    const categoryPath = path.join(promptsRoot, category);
    if (!(await pathExists(categoryPath))) {
      errors.push(`Missing prompt category directory: ${toPosix(categoryPath)}`);
    }
  }

  // Guard against legacy prompt categories (skills taxonomy doesn't apply to prompts)
  const LEGACY_PROMPT_CATEGORIES = ["guides", "conventions", "formats", "standards"];
  for (const legacy of LEGACY_PROMPT_CATEGORIES) {
    const legacyPath = path.join(promptsRoot, legacy);
    if (await pathExists(legacyPath)) {
      errors.push(`Legacy prompt category should not exist: ${toPosix(legacyPath)} (prompts use workflow-intent categories: ${PROMPT_CATEGORIES.join(", ")})`);
    }
  }

  const promptRootFiles = (await listFiles(promptsRoot)).filter((file) => file.endsWith(".md"));
  for (const file of promptRootFiles) {
    errors.push(`Prompt file must be in a taxonomy category directory: ${toPosix(file)}`);
  }

  for (const category of PROMPT_CATEGORIES) {
    const categoryPath = path.join(promptsRoot, category);
    if (!(await pathExists(categoryPath))) continue;

    const files = await listFiles(categoryPath);
    for (const file of files) {
      const isMarkdown = file.endsWith(".md");
      const isGitkeep = path.basename(file) === ".gitkeep";
      if (!isMarkdown && !isGitkeep) {
        errors.push(`Unexpected non-markdown file in prompt category: ${toPosix(file)}`);
        continue;
      }

      if (!isMarkdown) continue;

      // Validate prompt frontmatter
      const content = await fs.readFile(file, "utf8");
      const frontmatter = parseFrontmatter(content);
      const displayPath = toPosix(file);

      if (!frontmatter) {
        errors.push(`Prompt missing frontmatter: ${displayPath}`);
        continue;
      }

      if (!frontmatter.description) {
        errors.push(`Prompt missing frontmatter description: ${displayPath}`);
      }

      // Validate body content exists
      const body = extractBody(content);
      if (!body) {
        errors.push(`Prompt has empty body: ${displayPath}`);
      }
    }

    const nestedDirs = await listDirs(categoryPath);
    for (const nestedDir of nestedDirs) {
      errors.push(`Prompt taxonomy is one-level only; move files out of nested dir: ${toPosix(nestedDir)}`);
    }
  }
}

async function validateSkillTaxonomy() {
  for (const category of SKILL_CATEGORIES) {
    const categoryPath = path.join(skillsRoot, category);
    if (!(await pathExists(categoryPath))) {
      errors.push(`Missing skill category directory: ${toPosix(categoryPath)}`);
    }
  }

  const skillRootEntries = await fs.readdir(skillsRoot, { withFileTypes: true });
  for (const entry of skillRootEntries) {
    if (!entry.isDirectory()) {
      if (entry.name === ".gitkeep" || entry.name === ".DS_Store") continue;
      errors.push(`Unexpected file at skills root: ${toPosix(path.join(skillsRoot, entry.name))}`);
      continue;
    }
    if (!SKILL_CATEGORIES.includes(entry.name)) {
      errors.push(`Skill directory must be under a taxonomy category: ${toPosix(path.join(skillsRoot, entry.name))}`);
    }
  }

  const skillNames = new Set();
  const categoryCounts = new Map(SKILL_CATEGORIES.map((category) => [category, 0]));

  for (const category of SKILL_CATEGORIES) {
    const categoryPath = path.join(skillsRoot, category);
    if (!(await pathExists(categoryPath))) continue;

    const skillDirs = await listDirs(categoryPath);
    for (const skillDir of skillDirs) {
      const skillMd = path.join(skillDir, "SKILL.md");
      const displayPath = toPosix(skillMd);

      if (!(await pathExists(skillMd))) {
        errors.push(`Skill missing SKILL.md: ${toPosix(skillDir)}`);
        continue;
      }

      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      const content = await fs.readFile(skillMd, "utf8");
      const frontmatter = parseFrontmatter(content);
      const dirName = path.basename(skillDir);

      if (!frontmatter) {
        errors.push(`Skill missing frontmatter: ${displayPath}`);
        continue;
      }

      // Validate name
      const declaredName = frontmatter.name;
      if (!declaredName) {
        errors.push(`Skill missing frontmatter name: ${displayPath}`);
      } else if (declaredName !== dirName) {
        errors.push(
          `Skill frontmatter name must match directory name: ${displayPath} (name=${declaredName}, dir=${dirName})`
        );
      }

      // Validate unique name
      if (declaredName) {
        if (skillNames.has(declaredName)) {
          errors.push(`Duplicate skill name: ${displayPath} (name=${declaredName})`);
        }
        skillNames.add(declaredName);
      }

      // Validate description
      if (!frontmatter.description) {
        errors.push(`Skill missing frontmatter description: ${displayPath}`);
      }

      // Validate injection type
      const injection = frontmatter.injection;
      if (!injection) {
        errors.push(`Skill missing frontmatter injection type: ${displayPath}`);
      } else if (!VALID_INJECTION_TYPES.includes(injection)) {
        errors.push(
          `Skill has invalid injection type "${injection}" (expected: ${VALID_INJECTION_TYPES.join(", ")}): ${displayPath}`
        );
      }

      // Validate detect rules exist for detect injection
      if (injection === "detect") {
        const detect = frontmatter.detect;
        if (!detect || typeof detect !== "object" || Object.keys(detect).length === 0) {
          errors.push(`Skill with injection: detect must have detect rules: ${displayPath}`);
        }
      }

      // Validate body content exists (non-empty after frontmatter)
      const body = extractBody(content);
      if (!body) {
        errors.push(`Skill has empty body: ${displayPath}`);
      }
    }
  }

  errors.push(...validateSkillCategoryCounts({ categories: SKILL_CATEGORIES, counts: categoryCounts }));
  return skillNames;
}

async function discoverExtensionEntryPoints(rootDir) {
  const files = await listFiles(rootDir);
  const dirs = await listDirs(rootDir);

  const topLevel = files.filter((file) => file.endsWith(".ts"));
  const nested = [];

  for (const dirPath of dirs) {
    const indexPath = path.join(dirPath, "index.ts");
    if (await pathExists(indexPath)) {
      nested.push(indexPath);
    } else {
      // Subdirectories without index.ts: discover individual .ts files
      // (e.g. extensions/workflows/tdd.ts, extensions/workflows/triage.ts)
      const subFiles = await listFiles(dirPath);
      nested.push(...subFiles.filter((f) => f.endsWith(".ts")));
    }
  }

  return [...topLevel, ...nested].sort();
}

async function validateExtensionTaxonomy() {
  if (!(await pathExists(extensionCoreRoot))) {
    errors.push(`Missing shared extension core directory: ${toPosix(extensionCoreRoot)}`);
    return;
  }

  const coreFiles = [
    "extension-core.ts",
    "guardian-extension-core.ts",
    "interceptor-extension-core.ts",
    "workflow-extension-core.ts",
    "widget-extension-core.ts",
    "integration-extension-core.ts",
    "ui.ts",
  ];

  for (const coreFile of coreFiles) {
    const corePath = path.join(extensionCoreRoot, coreFile);
    if (!(await pathExists(corePath))) {
      errors.push(`Missing extension core file: ${toPosix(corePath)}`);
    }
  }

  const extensionEntries = [
    ...(await discoverExtensionEntryPoints(extensionsRoot)),
    ...(await discoverExtensionEntryPoints(optionalExtensionsRoot)),
  ].sort();

  for (const extensionPath of extensionEntries) {
    const content = await fs.readFile(extensionPath, "utf8");
    const displayPath = toPosix(extensionPath);

    const extendsCategoryCore = EXTENSION_BASE_CLASSES.some((baseClass) =>
      new RegExp(`extends\\s+${baseClass}`).test(content)
    );

    if (!extendsCategoryCore) {
      errors.push(
        `Extension must extend a taxonomy core class (${EXTENSION_BASE_CLASSES.join(", ")}): ${displayPath}`
      );
    }

    if (!/protected\s+registerExtension\(\):\s*void/.test(content)) {
      errors.push(`Extension should implement protected registerExtension(): ${displayPath}`);
    }
  }
}

async function validateSubagentStructure(skillNames) {
  if (!(await pathExists(subagentsRoot))) {
    errors.push(`Missing subagents directory: ${toPosix(subagentsRoot)}`);
    return { agentNames: new Set(), agentCapabilities: new Map() };
  }

  const agentNames = new Set();
  const agentCapabilities = new Map();
  const files = await listFiles(subagentsRoot);
  const agentFiles = files.filter((f) => f.endsWith(".md") && !f.endsWith(".chain.md"));

  for (const file of agentFiles) {
    const basename = path.basename(file);
    if (basename === "README.md") continue;

    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    const displayPath = toPosix(file);

    if (!frontmatter) {
      errors.push(`Subagent missing frontmatter: ${displayPath}`);
      continue;
    }

    if (!frontmatter.name) {
      errors.push(`Subagent missing frontmatter name: ${displayPath}`);
    } else {
      if (agentNames.has(frontmatter.name)) {
        errors.push(`Duplicate subagent name: ${displayPath} (name=${frontmatter.name})`);
      }
      agentNames.add(frontmatter.name);
    }

    if (!frontmatter.description) {
      errors.push(`Subagent missing frontmatter description: ${displayPath}`);
    }

    if (frontmatter.name) {
      agentCapabilities.set(frontmatter.name, capabilitiesForTools(frontmatter.tools));
    }
    errors.push(...validateAgentContent({ content, filePath: displayPath, skillNames }));

    // Body content check
    const body = extractBody(content);
    if (!body) {
      errors.push(`Subagent has empty body (no system prompt): ${displayPath}`);
    }
  }

  // Also collect chain names
  const chainFiles = files.filter((f) => f.endsWith(".chain.md"));
  for (const file of chainFiles) {
    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter?.name) {
      agentNames.add(frontmatter.name);
    }
  }

  return { agentNames, agentCapabilities };
}

async function discoverWorkflowContracts() {
  const workflowDir = path.join(extensionsRoot, "workflows");
  const files = (await listFiles(workflowDir)).filter((file) => file.endsWith(".ts"));
  const ralphPath = path.join(extensionsRoot, "ralph-loop.ts");
  if (await pathExists(ralphPath)) files.push(ralphPath);

  const workflowIds = new Set();
  const sources = [];
  for (const file of files.sort()) {
    const source = await fs.readFile(file, "utf8");
    sources.push({ file, source });
    const definitionMatch = source.match(/(?:WorkflowDefinition\s*=|return)\s*\{[\s\S]*?\bid:\s*["']([^"']+)["']/);
    if (definitionMatch) workflowIds.add(definitionMatch[1]);
  }

  const specPaths = [
    path.join(extensionCoreRoot, "review.workflow.json"),
    path.join(workflowDir, "build.workflow.json"),
  ];
  const specs = [];
  for (const file of specPaths) {
    if (!(await pathExists(file))) continue;
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    specs.push({ file, value, tasks: collectWorkflowSpecTasks(value) });
  }

  return { workflowIds, sources, specs };
}

function collectWorkflowSpecTasks(value) {
  if (Array.isArray(value)) return value.flatMap(collectWorkflowSpecTasks);
  if (!value || typeof value !== "object") return [];

  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  return [
    ...tasks,
    ...Object.entries(value)
      .filter(([key]) => key !== "tasks")
      .flatMap(([, nested]) => collectWorkflowSpecTasks(nested)),
  ];
}

async function validateSemanticContracts(skillNames, agentNames, agentCapabilities) {
  const { workflowIds, sources, specs } = await discoverWorkflowContracts();

  for (const { file, source } of sources) {
    if (path.basename(file) === "build.ts") continue;
    errors.push(...validateWorkflowSource({
      source,
      filePath: toPosix(file),
      agentCapabilities,
      knownAgents: agentNames,
      skillNames,
    }));
  }

  for (const { file, value, tasks } of specs) {
    if (path.basename(file) === "build.workflow.json") {
      errors.push(...validateBuildWorkflowConfig({ spec: value, filePath: toPosix(file) }));
    }
    errors.push(...validateWorkflowTaskSpecs({
      tasks,
      filePath: toPosix(file),
      agentCapabilities,
      knownAgents: agentNames,
      skillNames,
    }));
  }

  const promptFiles = [];
  for (const category of PROMPT_CATEGORIES) {
    const categoryPath = path.join(promptsRoot, category);
    if (!(await pathExists(categoryPath))) continue;
    for (const file of (await listFiles(categoryPath)).filter((item) => item.endsWith(".md"))) {
      promptFiles.push(`${category}/${path.basename(file)}`);
      const content = await fs.readFile(file, "utf8");
      errors.push(...validatePromptContent({
        content,
        filePath: toPosix(file),
        agentNames,
        workflowIds,
        skillNames,
      }));
    }
  }

  const settingsPath = path.join(agentRoot, "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  errors.push(...validateSettingsPromptPaths({
    promptPaths: settings.prompts,
    categories: PROMPT_CATEGORIES,
    promptFiles,
  }));

  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
  errors.push(...validateClassifierDocumentation({ readme, settings }));
}

async function main() {
  await validateNoLegacyDirectories();
  await validatePromptTaxonomy();
  const skillNames = await validateSkillTaxonomy();
  const { agentNames, agentCapabilities } = await validateSubagentStructure(skillNames);
  await validateSemanticContracts(skillNames, agentNames, agentCapabilities);
  await validateExtensionTaxonomy();

  if (errors.length > 0) {
    console.error("Taxonomy validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Taxonomy validation passed.");
  console.log(`Prompt categories: ${PROMPT_CATEGORIES.join(", ")}`);
  console.log(`Skill categories: ${SKILL_CATEGORIES.join(", ")}`);
  console.log(`Skill injection types: ${VALID_INJECTION_TYPES.join(", ")}`);
  console.log(`Subagent definitions: ${agentNames.size}`);
  console.log(`Extension base classes: ${EXTENSION_BASE_CLASSES.join(", ")}`);
}

main().catch((error) => {
  console.error(`Taxonomy validation crashed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
