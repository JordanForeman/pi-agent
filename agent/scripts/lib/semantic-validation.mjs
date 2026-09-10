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

export function extractWorkflowContracts(source, filePath = "workflow source") {
  const matches = [...source.matchAll(/\bagent:\s*["']([^"']+)["']/g)];
  return matches.map((match) => {
    const afterAgent = source.slice((match.index ?? 0) + match[0].length);
    const requiresMatch = afterAgent.match(/^\s*,?\s*requires:\s*\[([^\]]*)\]/);
    const requires = requiresMatch
      ? [...requiresMatch[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1])
      : [];
    return { agent: match[1], requires, declaresRequires: Boolean(requiresMatch), filePath };
  });
}

export function validateWorkflowSource({
  source,
  filePath,
  agentCapabilities,
  knownAgents,
  allowedBuiltins = new Set(),
}) {
  const diagnostics = [];
  for (const match of source.matchAll(/\bagent:\s*(\S)/g)) {
    if (match[1] !== '"' && match[1] !== "'") {
      diagnostics.push(diagnostic(filePath, `Workflow task agent must be a static string literal near offset ${match.index}`));
    }
  }

  diagnostics.push(...validateWorkflowContracts({
    tasks: extractWorkflowContracts(source, filePath),
    filePath,
    agentCapabilities,
    knownAgents,
    allowedBuiltins,
  }));
  return diagnostics;
}

export function validateWorkflowTaskSpecs({
  tasks,
  filePath,
  agentCapabilities,
  knownAgents,
  allowedBuiltins = new Set(),
}) {
  const contracts = tasks.map((task, index) => {
    const record = task && typeof task === "object" && !Array.isArray(task) ? task : {};
    const agent = typeof record.agent === "string" ? record.agent : "";
    const declaresRequires = Array.isArray(record.requires);
    const requires = declaresRequires
      ? record.requires.filter((requirement) => typeof requirement === "string")
      : [];
    return { agent, requires, declaresRequires, filePath, index };
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
  }

  diagnostics.push(...validateWorkflowContracts({
    tasks: contracts,
    filePath,
    agentCapabilities,
    knownAgents,
    allowedBuiltins,
  }));
  return diagnostics;
}

function validateWorkflowContracts({ tasks, filePath, agentCapabilities, knownAgents, allowedBuiltins }) {
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
