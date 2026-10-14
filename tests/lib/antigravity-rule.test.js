/**
 * Antigravity only attaches workspace rules that declare an activation
 * trigger in frontmatter. Covers the rule adapter used by the antigravity
 * install target.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { adaptAntigravityRule } = require('../../scripts/lib/install/antigravity-rule');
const { transformInstallContent } = require('../../scripts/lib/install/content-transform');

const REPO_ROOT = path.join(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function readRule(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function runTests() {
  console.log('\n=== Testing Antigravity rule adapter ===\n');

  let passed = 0;
  let failed = 0;

  if (test('marks a rule without frontmatter as always_on', () => {
    const source = readRule('rules/common/patterns.md');
    const adapted = adaptAntigravityRule(source, 'rules/common/patterns.md');

    assert.ok(adapted.startsWith('---\ntrigger: always_on\n---\n'));
    assert.strictEqual(adapted.slice('---\ntrigger: always_on\n---\n'.length), source);
  })) passed++; else failed++;

  if (test('maps Claude paths frontmatter to an Antigravity glob trigger', () => {
    const source = readRule('rules/python/coding-style.md');
    const adapted = adaptAntigravityRule(source, 'rules/python/coding-style.md');

    assert.ok(
      adapted.startsWith('---\ntrigger: glob\nglobs: **/*.py,**/*.pyi\n---\n'),
      adapted.slice(0, 80)
    );
    assert.ok(!/^paths:/m.test(adapted.split('\n---\n')[0]), 'paths should not survive');
    assert.ok(adapted.endsWith(source.slice(source.indexOf('\n---\n', 3) + '\n---\n'.length)));
  })) passed++; else failed++;

  if (test('accepts a single string path and CRLF line endings', () => {
    const adapted = adaptAntigravityRule('---\r\npaths: "src/**/*.ts"\r\n---\r\n# Rule\r\n');

    assert.strictEqual(adapted, '---\ntrigger: glob\nglobs: src/**/*.ts\n---\n# Rule\r\n');
  })) passed++; else failed++;

  if (test('keeps a description and defaults to always_on without paths', () => {
    const adapted = adaptAntigravityRule('---\ndescription: Shared guidance\n---\n# Rule\n');

    assert.strictEqual(
      adapted,
      '---\ntrigger: always_on\ndescription: "Shared guidance"\n---\n# Rule\n'
    );
  })) passed++; else failed++;

  if (test('leaves a rule that already declares a trigger unchanged', () => {
    const source = '---\ntrigger: model_decision\ndescription: Use for APIs\n---\n# Rule\n';

    assert.strictEqual(adaptAntigravityRule(source), source);
    assert.strictEqual(adaptAntigravityRule(adaptAntigravityRule('# Rule\n')), adaptAntigravityRule('# Rule\n'));
  })) passed++; else failed++;

  if (test('rejects non-object frontmatter', () => {
    assert.throws(
      () => adaptAntigravityRule('---\n- one\n- two\n---\n# Rule\n', 'rules/x/bad.md'),
      /Cannot adapt Antigravity rule rules\/x\/bad\.md/
    );
  })) passed++; else failed++;

  if (test('is registered as the antigravity-rule-frontmatter install transform', () => {
    const adapted = transformInstallContent(
      { contentTransform: 'antigravity-rule-frontmatter', sourceRelativePath: 'rules/common/testing.md' },
      '# Testing\n'
    );

    assert.strictEqual(adapted, '---\ntrigger: always_on\n---\n# Testing\n');
  })) passed++; else failed++;

  if (test('gives every shipped rule pack file an activation trigger', () => {
    const rulesRoot = path.join(REPO_ROOT, 'rules');
    const packs = fs.readdirSync(rulesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
    let checked = 0;

    for (const pack of packs) {
      for (const fileName of fs.readdirSync(path.join(rulesRoot, pack.name))) {
        if (!fileName.endsWith('.md')) continue;
        const relativePath = `rules/${pack.name}/${fileName}`;
        const adapted = adaptAntigravityRule(readRule(relativePath), relativePath);
        assert.ok(
          /^---\ntrigger: (always_on|glob\nglobs: \S+)\n/.test(adapted),
          `${relativePath} has no Antigravity trigger`
        );
        checked += 1;
      }
    }

    assert.ok(checked > 0, 'Should check at least one rule');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
