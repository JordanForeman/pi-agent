import { parseFrontmatter } from "./frontmatter.mjs";

function listValue(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function diagnostic(filePath, message) {
  return `${message}: ${filePath}`;
}

export function validatePromptContent({ content, filePath, agentNames, workflowIds, skillNames = new Set() }) {
  const diagnostics = [];
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return diagnostics;

  for (const agent of listValue(frontmatter.subagents)) {
    if (!agentNames.has(agent)) {
      diagnostics.push(diagnostic(filePath, `Prompt references unknown subagent "${agent}"`));
    }
  }

  if (typeof frontmatter.workflow === "string" && !workflowIds.has(frontmatter.workflow)) {
    diagnostics.push(diagnostic(filePath, `Prompt references unknown workflow "${frontmatter.workflow}"`));
  }

  for (const field of ["subagent", "relation"]) {
    if (new RegExp(`"${field}"\\s*:`).test(content)) {
      diagnostics.push(diagnostic(filePath, `Prompt uses obsolete subagent tool field "${field}"`));
    }
  }

  for (const match of content.matchAll(/"skill"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
    const skillRefs = match[1].startsWith("[")
      ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
      : [match[1].slice(1, -1)];
    for (const skill of skillRefs) {
      if (!skillNames.has(skill)) diagnostics.push(diagnostic(filePath, `Prompt references unknown skill "${skill}"`));
    }
  }

  return diagnostics;
}

export function validateSettingsPromptPaths({ promptPaths, categories, promptFiles }) {
  const expected = categories.map((category) => `../agent/prompts/${category}`);
  const actual = Array.isArray(promptPaths) ? promptPaths : [];
  const diagnostics = [];

  if (actual.length !== expected.length || expected.some((entry) => !actual.includes(entry))) {
    diagnostics.push(`Settings prompt paths must exactly match canonical categories: ${expected.join(", ")}`);
    return diagnostics;
  }

  const covered = new Map(promptFiles.map((file) => [file, 0]));
  for (const promptPath of actual) {
    const category = promptPath.split("/").at(-1);
    for (const file of promptFiles) {
      if (file.startsWith(`${category}/`)) covered.set(file, (covered.get(file) ?? 0) + 1);
    }
  }

  for (const [file, count] of covered) {
    if (count !== 1) diagnostics.push(`Settings prompt discovery covers ${file} ${count} times (expected once)`);
  }

  return diagnostics;
}

// This is a bounded canonical-source validator, not a TypeScript parser.
// Consume strings before comments so markers in task/capability text stay text.
const quotedSource = String.raw`(?:"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*')`;
const sourceString = `${quotedSource}|\u0060(?:\\\\[\\s\\S]|[^\u0060\\\\])*\u0060`;
function withoutSourceComments(source) {
  return source.replace(new RegExp(`(${sourceString})|/\\*[\\s\\S]*?\\*/|//[^\\r\\n]*`, "g"),
    (text, string) => string ?? text.replace(/[^\r\n]/g, " "));
}
const sourceLiteralArray = `\\[\\s*(?:${quotedSource}(?:\\s*,\\s*${quotedSource})*\\s*,?)?\\s*\\]`;
function agentDeclarations(source) {
  // The string alternative prevents finding agent metadata inside task text.
  return [...source.matchAll(new RegExp(`\\bagent\\s*:\\s*(${quotedSource}|\\S)|${sourceString}`, "g"))]
    .filter((match) => match[1] !== undefined);
}
function canonicalTaskSuffix(source) {
  const taskString = `(?:${sourceString})`;
  const taskArray = `\\[\\s*(?:${taskString}(?:\\s*,\\s*${taskString})*\\s*,?)?\\s*\\]`;
  const text = `(?:${taskString}|${taskArray}\\s*\\.\\s*join\\s*\\(\\s*${quotedSource}\\s*\\))`;
  const property = new RegExp(`^\\s*,\\s*(?:(task|label)\\s*:\\s*(${text})|(skill)\\s*:\\s*(${sourceLiteralArray}))`);
  const seen = new Set();
  let hasLateSkill = false;
  while (!/^\s*,?\s*}/.test(source)) {
    const match = source.match(property);
    if (!match) return { valid: false, hasLateSkill };
    const name = match[1] ?? match[3];
    if (seen.has(name)) return { valid: false, hasLateSkill };
    seen.add(name);
    if (name === "skill") hasLateSkill = true;
    source = source.slice(match[0].length);
  }
  return { valid: true, hasLateSkill };
}

export function extractWorkflowContracts(source, filePath = "workflow source") {
  source = withoutSourceComments(source);
  const matches = agentDeclarations(source).filter((match) => /^["']/.test(match[1]));
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const afterAgent = source.slice(start, end);
    const requiresMatch = afterAgent.match(new RegExp(`^\\s*,?\\s*requires\\s*:\\s*\\[((?:${quotedSource}|[^\\]"'])*)\\]`));
    // Validate the entire array, not just the quoted substrings inside expressions.
    const literal = /(?:"[^"\\\r\n]*"|'[^'\\\r\n]*')/;
    const literalArray = new RegExp(`^\\s*(?:${literal.source}(?:\\s*,\\s*${literal.source})*\\s*,?)?\\s*$`);
    const validRequires = Boolean(requiresMatch && literalArray.test(requiresMatch[1])
      && /^\s*(?:,|})/.test(afterAgent.slice(requiresMatch[0].length)));
    const requires = validRequires
      ? [...requiresMatch[1].matchAll(new RegExp(literal.source, "g"))].map((item) => item[0].slice(1, -1))
      : [];
    const afterRequires = requiresMatch ? afterAgent.slice(requiresMatch[0].length) : "";
    const skillMatch = afterRequires.match(new RegExp(`^\\s*,?\\s*skill\\s*:\\s*(${sourceLiteralArray})`));
    const skills = skillMatch
      ? [...skillMatch[1].matchAll(new RegExp(quotedSource, "g"))].map((item) => item[0].slice(1, -1))
      : [];
    const suffix = canonicalTaskSuffix(skillMatch ? afterRequires.slice(skillMatch[0].length) : afterRequires);
    const hasLateSkill = Boolean(requiresMatch && suffix.hasLateSkill);
    return { agent: match[1].slice(1, -1), requires, skills, declaresRequires: Boolean(requiresMatch), invalidRequires: Boolean(requiresMatch && !validRequires), invalidTaskMetadata: Boolean(requiresMatch && !suffix.valid), hasLateSkill, filePath };
  });
}

export function validateWorkflowSource({
  source,
  filePath,
  agentCapabilities,
  knownAgents,
  allowedBuiltins = new Set(),
  skillNames,
}) {
  const diagnostics = [];
  for (const match of agentDeclarations(withoutSourceComments(source))) {
    if (!/^["']/.test(match[1])) {
      diagnostics.push(diagnostic(filePath, `Workflow task agent must be a static string literal near offset ${match.index}`));
    }
  }

  const tasks = extractWorkflowContracts(source, filePath);
  for (const task of tasks) {
    if (task.invalidRequires) {
      diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${task.agent}" requires array must contain only static string literals`));
    }
    if (task.invalidTaskMetadata) {
      diagnostics.push(diagnostic(filePath, `Workflow canonical source task must use literal task/label text or joined literal text arrays after requires/skill; metadata overrides and spreads are unsupported`));
    }
    if (task.hasLateSkill) {
      diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${task.agent}" must declare skill immediately after requires`));
    }
  }

  diagnostics.push(...validateWorkflowContracts({
    tasks,
    filePath,
    agentCapabilities,
    knownAgents,
    allowedBuiltins,
    skillNames,
  }));
  return diagnostics;
}

export function validateWorkflowTaskSpecs({
  tasks,
  filePath,
  agentCapabilities,
  knownAgents,
  allowedBuiltins = new Set(),
  skillNames,
}) {
  const contracts = tasks.map((task, index) => {
    const record = task && typeof task === "object" && !Array.isArray(task) ? task : {};
    const agent = typeof record.agent === "string" ? record.agent : "";
    const declaresRequires = Array.isArray(record.requires);
    const requires = declaresRequires
      ? record.requires.filter((requirement) => typeof requirement === "string")
      : [];
    const skills = Array.isArray(record.skill)
      ? record.skill.filter((skill) => typeof skill === "string")
      : [];
    return { agent, requires, skills, declaresRequires, filePath, index };
  });

  const diagnostics = [];
  for (const contract of contracts) {
    if (!contract.agent) {
      diagnostics.push(diagnostic(filePath, `Workflow task ${contract.index + 1} must declare a static agent string`));
    }
    const source = tasks[contract.index];
    if (Array.isArray(source?.requires) && source.requires.some((requirement) => typeof requirement !== "string")) {
      diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${contract.agent || "unknown"}" has a non-string capability requirement`));
    }
    if (source?.skill !== undefined && (!Array.isArray(source.skill) || source.skill.some((skill) => typeof skill !== "string"))) {
      diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${contract.agent || "unknown"}" must use a string skill array`));
    }
  }

  diagnostics.push(...validateWorkflowContracts({
    tasks: contracts,
    filePath,
    agentCapabilities,
    knownAgents,
    allowedBuiltins,
    skillNames,
  }));
  return diagnostics;
}

function validateWorkflowContracts({ tasks, filePath, agentCapabilities, knownAgents, allowedBuiltins, skillNames }) {
  const diagnostics = [];
  for (const task of tasks) {
    if (!task.declaresRequires) {
      diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${task.agent || "unknown"}" must declare an explicit requires array`));
    }

    if (!task.agent) continue;
    if (!knownAgents.has(task.agent) && !allowedBuiltins.has(task.agent)) {
      diagnostics.push(diagnostic(filePath, `Workflow references unknown workflow agent "${task.agent}"`));
      continue;
    }

    if (skillNames) {
      for (const skill of task.skills ?? []) {
        if (!skillNames.has(skill)) {
          diagnostics.push(diagnostic(filePath, `Workflow task assigned to "${task.agent}" references unknown skill "${skill}"`));
        }
      }
    }

    const capabilities = agentCapabilities.get(task.agent) ?? new Set();
    for (const requirement of task.requires) {
      if (!capabilities.has(requirement)) {
        diagnostics.push(diagnostic(
          filePath,
          `Workflow task assigned to "${task.agent}" requires capability "${requirement}"`,
        ));
      }
    }
  }
  return diagnostics;
}

export function validateAgentContent({ content, filePath, skillNames }) {
  const diagnostics = [];
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return diagnostics;

  if (Array.isArray(frontmatter.skills)) {
    diagnostics.push(diagnostic(filePath, "Subagent skills must use a comma-separated frontmatter string"));
  }
  for (const skill of listValue(frontmatter.skills ?? frontmatter.skill)) {
    if (!skillNames.has(skill)) {
      diagnostics.push(diagnostic(filePath, `Subagent references unknown skill "${skill}"`));
    }
  }

  const tools = new Set(listValue(frontmatter.tools).map((tool) => tool.toLowerCase()));
  const orchestrationSection = /orchestration protocol/i.test(content);
  const mandatoryDelegation = /\b(?:must|always)\s+(?:gather[\s\S]{0,80}?using subagents|delegate)\b/i.test(content);
  if (orchestrationSection && mandatoryDelegation && !tools.has("subagent")) {
    diagnostics.push(diagnostic(filePath, "Subagent mandates nested delegation without the subagent tool"));
  }

  return diagnostics;
}

export function validateSkillCategoryCounts({ categories, counts }) {
  const diagnostics = [];
  for (const category of categories) {
    if ((counts.get(category) ?? 0) === 0) {
      diagnostics.push(`Required skill category "${category}" is empty`);
    }
  }
  return diagnostics;
}

export function validateClassifierDocumentation({ readme, settings }) {
  const diagnostics = [];
  const hasLimitation = /automatic classify-only activation is disabled/i.test(readme);
  const hasExplicitInvocation = /\/skill:<name>/i.test(readme);
  if (!hasLimitation || !hasExplicitInvocation) {
    diagnostics.push("README must state that automatic classify-only activation is disabled and document /skill:<name> invocation");
  }
  if (settings?.enableSkillCommands !== true) {
    diagnostics.push("Settings must set enableSkillCommands: true so documented explicit skill invocation is enabled");
  }
  return diagnostics;
}

export function capabilitiesForTools(tools) {
  const normalized = new Set(listValue(tools).map((tool) => tool.toLowerCase()));
  const capabilities = new Set();
  if (normalized.has("edit") || normalized.has("write")) capabilities.add("filesystem-write");
  if (normalized.has("bash")) capabilities.add("shell");
  return capabilities;
}
