import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareExtensionPath } from './stage-extension.mjs';

const packageName = 'com.danosito.afterbird';
const extensionPath = '/data/local/tmp/ext/ubolite';

function fakeShell(manifest, { failStage = false } = {}) {
  const calls = [];
  const shell = async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('cat ')) return JSON.stringify(manifest);
    if (failStage) throw new Error('run-as: package not debuggable');
    return '';
  };
  return { shell, calls };
}

test('non-DNR MV2 extension stays at the original path', async () => {
  const { shell, calls } = fakeShell({ manifest_version: 2 });
  assert.equal(await prepareExtensionPath(extensionPath, { packageName, shell }), extensionPath);
  assert.deepEqual(calls, [`cat ${extensionPath}/manifest.json`]);
});

test('MV3 without static DNR resources stays at the original path', async () => {
  const { shell, calls } = fakeShell({ manifest_version: 3, permissions: ['scripting'] });
  assert.equal(await prepareExtensionPath(extensionPath, { packageName, shell }), extensionPath);
  assert.equal(calls.length, 1);
});

test('MV3 static DNR resources are copied to writable app storage', async () => {
  const { shell, calls } = fakeShell({
    manifest_version: 3,
    declarative_net_request: { rule_resources: [{ id: 'main', enabled: true, path: 'rules.json' }] },
  });
  const hash = createHash('sha256').update(extensionPath).digest('hex').slice(0, 20);
  const parent = `/data/data/${packageName}/files/afterbird-unpacked`;
  const destination = `${parent}/${hash}`;
  assert.equal(await prepareExtensionPath(extensionPath, { packageName, shell }), destination);
  assert.deepEqual(calls, [
    `cat ${extensionPath}/manifest.json`,
    `run-as ${packageName} sh -c 'mkdir -p ${parent} && rm -rf ${destination} && cp -R ${extensionPath} ${destination}'`,
  ]);
});

test('DNR copy failure reports the test-build requirement', async () => {
  const { shell } = fakeShell({ declarative_net_request: { rule_resources: [{}] } }, { failStage: true });
  await assert.rejects(
    prepareExtensionPath(extensionPath, { packageName, shell }),
    /Use a debuggable test APK/,
  );
});

test('invalid manifest yields an actionable error', async () => {
  await assert.rejects(
    prepareExtensionPath(extensionPath, { packageName, shell: async () => '{not-json' }),
    /Cannot read extension manifest/,
  );
});

test('untrusted package and path cannot reach a shell command', async () => {
  const { shell, calls } = fakeShell({});
  for (const value of ['/data/local/tmp/x;touch/tmp/oops', '/data/local/tmp/../etc', '/data/local/tmp/ext,name']) {
    await assert.rejects(prepareExtensionPath(value, { packageName, shell }), /Invalid extension path/);
  }
  await assert.rejects(prepareExtensionPath(extensionPath, { packageName: 'com.a;rm', shell }), /Invalid Android package/);
  assert.deepEqual(calls, []);
});
