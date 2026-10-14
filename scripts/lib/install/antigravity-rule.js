'use strict';

// Antigravity only attaches a workspace rule when its frontmatter declares an
// activation trigger (always_on, glob, model_decision or manual). ECC's
// canonical rules are written for Claude Code: common rules have no
// frontmatter and language rules scope themselves with a `paths:` list, which
// Antigravity does not read. Without a trigger the installed files sit in
// .agents/rules/ and are never loaded.

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function parseFrontmatter(source, label) {
  const match = source.match(FRONTMATTER_PATTERN);
  if (!match) {
    return null;
  }
  // A rule that already declares a trigger is Antigravity-native. Detect it
  // before YAML parsing: native glob rules may hold unquoted `globs: **/*.ts`,
  // which a strict YAML parser rejects as an alias.
  if (/^trigger[ \t]*:/m.test(match[1])) {
    return { native: true };
  }

  // Keep YAML loading behind the transform boundary, like the agent adapter:
  // planning must stay free of runtime package dependencies.
  const frontmatter = require('js-yaml').load(match[1]);
  if (frontmatter === null || frontmatter === undefined) {
    return { frontmatter: {}, body: source.slice(match[0].length) };
  }
  if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Antigravity rule ${label}: frontmatter must be an object`);
  }

  return { frontmatter, body: source.slice(match[0].length) };
}

function toGlobList(paths) {
  const values = Array.isArray(paths) ? paths : [paths];
  return values
    .map(value => String(value).trim())
    .filter(Boolean);
}

function adaptAntigravityRule(source, label = '<unknown>') {
  const text = String(source || '');
  const parsed = parseFrontmatter(text, label);

  if (!parsed) {
    return `---\ntrigger: always_on\n---\n${text}`;
  }

  if (parsed.native) {
    return text;
  }

  const { frontmatter, body } = parsed;

  const globs = Object.hasOwn(frontmatter, 'paths') ? toGlobList(frontmatter.paths) : [];
  // Quote globs: a plain YAML scalar cannot start with `*` (alias indicator).
  const lines = globs.length > 0
    ? ['trigger: glob', `globs: ${JSON.stringify(globs.join(','))}`]
    : ['trigger: always_on'];

  if (typeof frontmatter.description === 'string' && frontmatter.description.trim()) {
    lines.push(`description: ${JSON.stringify(frontmatter.description.trim())}`);
  }

  return `---\n${lines.join('\n')}\n---\n${body}`;
}

module.exports = {
  adaptAntigravityRule,
};
