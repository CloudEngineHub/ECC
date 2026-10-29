#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeAgentTools } = require('./lib/agent-tools');

const TOOL_NAME_MAP = new Map([
  ['Read', 'read_file'],
  ['ReadFile', 'read_file'],
  ['NotebookRead', 'read_file'],
  ['Write', 'write_file'],
  ['Edit', 'replace'],
  ['MultiEdit', 'replace'],
  ['Bash', 'run_shell_command'],
  ['Grep', 'grep_search'],
  ['Glob', 'glob'],
  ['WebSearch', 'google_web_search'],
  ['WebFetch', 'web_fetch'],
]);

function usage() {
  return [
    'Adapt ECC agent frontmatter for Gemini CLI.',
    '',
    'Usage:',
    '  node scripts/gemini-adapt-agents.js [agents-dir]',
    '',
    'Defaults to .gemini/agents under the current working directory.',
    'Rewrites tools: to Gemini-compatible tool names and removes unsupported color: metadata.'
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      // Reject rather than ignore. This script rewrites files in place, so
      // silently discarding an unrecognized flag would let `--dry-run` — or any
      // mistyped option — modify every installed agent and still exit 0.
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error('Expected at most one agents directory argument');
  }

  return {
    help: false,
    agentsDir: path.resolve(positional[0] || path.join(process.cwd(), '.gemini', 'agents')),
  };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Agents directory not found: ${dirPath}`);
  }

  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Expected a directory: ${dirPath}`);
  }
}

function parseToolList(line) {
  const match = line.match(/^\s*tools\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  return normalizeAgentTools(match[1]);
}

function adaptToolName(toolName) {
  const mapped = TOOL_NAME_MAP.get(toolName);
  if (mapped) {
    return mapped;
  }

  if (toolName.startsWith('mcp__')) {
    return toolName
      .replace(/^mcp__/, 'mcp_')
      .replace(/__/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toLowerCase();
  }

  return toolName;
}

function formatToolLine(tools) {
  return `tools: [${tools.map(tool => JSON.stringify(tool)).join(', ')}]`;
}

function adaptFrontmatter(text) {
  // Normalize CRLF first. Matching only LF would silently skip a Windows-saved
  // agent and report it as already compatible while `tools: Read` and
  // `color: ...` stayed in place. The original ending style is restored below.
  const usesCrlf = text.includes('\r\n');
  const source = usesCrlf ? text.replace(/\r\n/g, '\n') : text;

  const match = source.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) {
    return { text, changed: false };
  }

  let changed = false;
  const updatedLines = [];
  const lines = match[1].split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*color\s*:/.test(line)) {
      changed = true;
      continue;
    }

    let tools = parseToolList(line);
    if (tools !== null && tools.length === 0 && /^\s*tools\s*:\s*$/.test(line)) {
      const sequenceItems = [];
      let lookahead = index;
      while (lookahead + 1 < lines.length && /^(?:\s*#|\s*$|(?:\s*-\s+.*))/.test(lines[lookahead + 1])) {
        lookahead += 1;
        const itemMatch = lines[lookahead].match(/^\s*-\s+(.*)$/);
        if (itemMatch) {
          sequenceItems.push(itemMatch[1]);
        }
      }
      if (sequenceItems.length > 0) {
        index = lookahead;
        changed = true;
        tools = normalizeAgentTools(sequenceItems);
      }
    }

    if (tools && tools.length > 0) {
      const adaptedTools = [];
      const seen = new Set();

      for (const tool of tools.map(adaptToolName)) {
        if (seen.has(tool)) {
          continue;
        }
        seen.add(tool);
        adaptedTools.push(tool);
      }

      const updatedLine = formatToolLine(adaptedTools);
      if (updatedLine !== line) {
        changed = true;
      }
      updatedLines.push(updatedLine);
      continue;
    }

    updatedLines.push(line);
  }

  if (!changed) {
    return { text, changed: false };
  }

  const adapted = `---\n${updatedLines.join('\n')}\n---${match[2]}${source.slice(match[0].length)}`;

  return {
    text: usesCrlf ? adapted.replace(/\n/g, '\r\n') : adapted,
    changed: true,
  };
}

function adaptAgents(dirPath) {
  ensureDirectory(dirPath);

  let updated = 0;
  let unchanged = 0;

  const prepared = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const original = fs.readFileSync(filePath, 'utf8');
    const adapted = adaptFrontmatter(original);
    prepared.push({ filePath, adapted });
  }

  for (const { filePath, adapted } of prepared) {
    if (adapted.changed) {
      fs.writeFileSync(filePath, adapted.text);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = adaptAgents(options.agentsDir);
  console.log(`Updated ${result.updated} agent file(s); ${result.unchanged} already compatible`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { adaptFrontmatter };
