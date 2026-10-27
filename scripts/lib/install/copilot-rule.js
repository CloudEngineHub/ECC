'use strict';

// GitHub Copilot loads path-specific instructions from
// `.github/instructions/**/*.instructions.md`, where the `applyTo` frontmatter
// key carries a comma-separated glob list. ECC rules express the same scoping
// with the Claude Code convention, a YAML `paths:` list, and rules without
// frontmatter apply to every prompt. The transform maps one model onto the
// other: `paths:` becomes `applyTo:`, and a rule without `paths` becomes
// `applyTo: "**"` so it keeps applying globally.
//
// The transform is an allowlist: only `paths` is read, so frontmatter keys
// added to ECC rules later cannot silently leak into the Copilot copy.

const GLOBAL_APPLY_TO = '**';

function splitFrontmatter(source, label) {
  const match = String(source || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return null;
  }

  // Keep YAML loading behind the transform boundary. Public help commands load
  // the installer graph without executing a transform, including in hermetic
  // packed-artifact checks where runtime dependencies are intentionally absent.
  const frontmatter = require('js-yaml').load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Copilot rule ${label}: frontmatter must be an object`);
  }

  return {
    frontmatter,
    body: String(source).slice(match[0].length),
  };
}

function serializeApplyTo(globs) {
  return require('js-yaml')
    .dump({ applyTo: globs }, { lineWidth: -1, noRefs: true })
    .trimEnd();
}

function adaptCopilotRule(source, label = '<unknown>') {
  const parsed = splitFrontmatter(source, label);

  if (!parsed) {
    return `---\napplyTo: "${GLOBAL_APPLY_TO}"\n---\n${String(source || '')}`;
  }

  const { frontmatter, body } = parsed;
  const paths = frontmatter.paths;

  if (paths === undefined) {
    return `---\napplyTo: "${GLOBAL_APPLY_TO}"\n---\n${body}`;
  }

  if (!Array.isArray(paths) || paths.some(glob => typeof glob !== 'string' || glob.trim() === '')) {
    throw new Error(`Cannot adapt Copilot rule ${label}: "paths" must be a list of glob strings`);
  }

  return `---\n${serializeApplyTo(paths.map(glob => glob.trim()).join(','))}\n---\n${body}`;
}

module.exports = {
  adaptCopilotRule,
  GLOBAL_APPLY_TO,
};
