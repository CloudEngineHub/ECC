/**
 * Regression tests for bounded hook stdin reads.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const {
  DEFAULT_STDIN_IDLE_TIMEOUT_MS,
  readStdinRaw,
  resolveStdinIdleTimeout
} = require('../../scripts/hooks/hook-input');
const { run: runConfigProtection } = require('../../scripts/hooks/config-protection');

const TEST_STDIN_LIMIT = 1024;
const STREAM_SETTLEMENT_TIMEOUT_MS = 500;
const TEST_IDLE_TIMEOUT_MS = 50;
const PRE_BASH_DISPATCHER = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-dispatcher.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function readFromErroredStream(partialInput) {
  const stream = new PassThrough();
  const resultPromise = readStdinRaw(stream, { maxStdin: TEST_STDIN_LIMIT });
  stream.write(partialInput);
  stream.destroy(new Error('simulated stdin read failure'));
  return resultPromise;
}

async function readFromClosedStream(partialInput) {
  const stream = new PassThrough();
  const resultPromise = readStdinRaw(stream, { maxStdin: TEST_STDIN_LIMIT });
  stream.write(partialInput);
  stream.destroy();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('readStdinRaw did not settle after stream close')),
      STREAM_SETTLEMENT_TIMEOUT_MS
    );
    resultPromise.then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function settleWithin(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
    promise.then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// The writer keeps the stream open and never sends EOF (#3665).
function readFromHeldOpenStream(chunks, options = {}) {
  const stream = new PassThrough();
  const resultPromise = readStdinRaw(stream, {
    maxStdin: TEST_STDIN_LIMIT,
    idleTimeoutMs: TEST_IDLE_TIMEOUT_MS,
    ...options
  });
  for (const chunk of chunks) stream.write(chunk);
  return { stream, resultPromise };
}

async function runTests() {
  console.log('\nHook input reader tests:');

  let passed = 0;
  let failed = 0;

  if (
    await test('clean end preserves complete input', async () => {
      const stream = new PassThrough();
      const resultPromise = readStdinRaw(stream, { maxStdin: TEST_STDIN_LIMIT });
      stream.end('{"complete":true}');

      assert.deepStrictEqual(await resultPromise, {
        raw: '{"complete":true}',
        truncated: false
      });
    })
  )
    passed++;
  else failed++;

  if (
    await test('stream error marks partial input as truncated', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{';
      const result = await readFromErroredStream(partialInput);

      assert.strictEqual(result.raw, partialInput);
      assert.strictEqual(result.truncated, true);
    })
  )
    passed++;
  else failed++;

  if (
    await test('close without end marks partial input as truncated', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{';
      const result = await readFromClosedStream(partialInput);

      assert.strictEqual(result.raw, partialInput);
      assert.strictEqual(result.truncated, true);
    })
  )
    passed++;
  else failed++;

  if (
    await test('errored partial PreToolUse input remains fail closed', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{"file_path":".eslintrc.js"';
      const inputResult = await readFromErroredStream(partialInput);
      const hookResult = runConfigProtection(inputResult.raw, {
        truncated: inputResult.truncated,
        maxStdin: TEST_STDIN_LIMIT
      });

      assert.strictEqual(inputResult.truncated, true);
      assert.strictEqual(hookResult.exitCode, 2);
      assert.match(hookResult.stderr, /Refusing to bypass config-protection/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('held-open stream with no input settles as truncated after the idle deadline', async () => {
      const { resultPromise } = readFromHeldOpenStream([]);
      const result = await settleWithin(resultPromise, STREAM_SETTLEMENT_TIMEOUT_MS, 'readStdinRaw');

      assert.deepStrictEqual(result, { raw: '', truncated: true });
    })
  )
    passed++;
  else failed++;

  if (
    await test('held-open stream with a partial request settles as truncated', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{';
      const { resultPromise } = readFromHeldOpenStream([partialInput]);
      const result = await settleWithin(resultPromise, STREAM_SETTLEMENT_TIMEOUT_MS, 'readStdinRaw');

      assert.strictEqual(result.raw, partialInput);
      assert.strictEqual(result.truncated, true);
    })
  )
    passed++;
  else failed++;

  if (
    await test('held-open stream with a complete JSON object settles as complete', async () => {
      const input = '{"tool_name":"Bash","tool_input":{"command":"ls"}}';
      const { resultPromise } = readFromHeldOpenStream([input.slice(0, 10), input.slice(10)]);
      const result = await settleWithin(resultPromise, STREAM_SETTLEMENT_TIMEOUT_MS, 'readStdinRaw');

      assert.deepStrictEqual(result, { raw: input, truncated: false });
    })
  )
    passed++;
  else failed++;

  if (
    await test('a complete JSON object past the byte cap stays truncated on the idle deadline', async () => {
      const input = JSON.stringify({ padding: 'x'.repeat(TEST_STDIN_LIMIT) });
      const { resultPromise } = readFromHeldOpenStream([input]);
      const result = await settleWithin(resultPromise, STREAM_SETTLEMENT_TIMEOUT_MS, 'readStdinRaw');

      assert.strictEqual(result.truncated, true);
      assert.strictEqual(Buffer.byteLength(result.raw), TEST_STDIN_LIMIT);
    })
  )
    passed++;
  else failed++;

  if (
    await test('each chunk resets the idle deadline', async () => {
      const { stream, resultPromise } = readFromHeldOpenStream([]);
      let settled = false;
      resultPromise.then(() => {
        settled = true;
      });
      for (const part of ['{"a":', '1', '}']) {
        await new Promise(resolve => setTimeout(resolve, TEST_IDLE_TIMEOUT_MS / 2));
        stream.write(part);
      }
      assert.strictEqual(settled, false, 'reader settled while chunks were still arriving');
      stream.end();

      assert.deepStrictEqual(await resultPromise, { raw: '{"a":1}', truncated: false });
    })
  )
    passed++;
  else failed++;

  if (
    await test('idleTimeoutMs 0 disables the deadline', async () => {
      const { stream, resultPromise } = readFromHeldOpenStream([], { idleTimeoutMs: 0 });
      let settled = false;
      resultPromise.then(() => {
        settled = true;
      });
      await new Promise(resolve => setTimeout(resolve, TEST_IDLE_TIMEOUT_MS * 3));
      assert.strictEqual(settled, false, 'reader settled with the deadline disabled');
      stream.end('{}');

      assert.deepStrictEqual(await resultPromise, { raw: '{}', truncated: false });
    })
  )
    passed++;
  else failed++;

  if (
    await test('resolveStdinIdleTimeout validates ECC_HOOK_INPUT_IDLE_TIMEOUT_MS', async () => {
      const diagnostics = [];
      const writeDiagnostic = message => diagnostics.push(message);

      assert.strictEqual(resolveStdinIdleTimeout(undefined), DEFAULT_STDIN_IDLE_TIMEOUT_MS);
      assert.strictEqual(resolveStdinIdleTimeout(''), DEFAULT_STDIN_IDLE_TIMEOUT_MS);
      assert.strictEqual(resolveStdinIdleTimeout('750'), 750);
      assert.strictEqual(resolveStdinIdleTimeout('0'), 0);
      assert.strictEqual(resolveStdinIdleTimeout('-1', { writeDiagnostic }), DEFAULT_STDIN_IDLE_TIMEOUT_MS);
      assert.strictEqual(resolveStdinIdleTimeout('soon', { writeDiagnostic }), DEFAULT_STDIN_IDLE_TIMEOUT_MS);
      // setTimeout would fire after 1 ms for a larger delay, so it is clamped.
      assert.strictEqual(resolveStdinIdleTimeout('9999999999', { writeDiagnostic }), 2 ** 31 - 1);
      assert.strictEqual(diagnostics.length, 3);
      assert.match(diagnostics[0], /ECC_HOOK_INPUT_IDLE_TIMEOUT_MS/);
      assert.match(diagnostics[2], /clamping/);
    })
  )
    passed++;
  else failed++;

  if (
    await test('pre-bash dispatcher exits fail closed when stdin is never closed', async () => {
      const child = spawn(process.execPath, [PRE_BASH_DISPATCHER], {
        env: { ...process.env, ECC_HOOK_INPUT_IDLE_TIMEOUT_MS: '100', ECC_HOOK_PROFILE: 'standard' },
        stdio: ['pipe', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      child.stdin.write('{"tool_name":"Bash","tool_input":{');
      const exitCode = await settleWithin(
        new Promise(resolve => child.once('exit', code => resolve(code))),
        5000,
        'pre-bash-dispatcher'
      ).finally(() => {
        child.stdin.destroy();
        child.kill();
      });

      assert.strictEqual(exitCode, 2);
      assert.match(stderr, /stdin stayed open without EOF for 100 ms/);
    })
  )
    passed++;
  else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
