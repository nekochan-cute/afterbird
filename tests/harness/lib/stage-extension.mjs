// A DNR extension cannot compile static rulesets when loaded from a directory
// that the browser may read but cannot write (for example /data/local/tmp).
// Stage *only* extensions with static DNR rulesets into app-owned storage.
// This helper is for the debuggable adb test harness, not the normal Web Store
// installation path (which Chromium already places in writable storage).
import { createHash } from 'node:crypto';

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
const PATH_RE = /^\/[a-zA-Z0-9_./-]+$/;

function assertSafeInput(extensionPath, packageName) {
  if (!PACKAGE_RE.test(packageName)) throw new Error(`Invalid Android package name: ${packageName}`);
  if (!PATH_RE.test(extensionPath) || extensionPath.split('/').includes('..') ||
      extensionPath.split('/').includes('.') || extensionPath.includes(',')) {
    throw new Error(`Invalid extension path for --load-extension: ${extensionPath}`);
  }
}

/**
 * @param {string} extensionPath Absolute on-device unpacked extension path.
 * @param {{packageName: string, shell: (command: string) => Promise<string>}} options
 * @returns {Promise<string>} Path usable in --load-extension.
 */
export async function prepareExtensionPath(extensionPath, { packageName, shell }) {
  assertSafeInput(extensionPath, packageName);
  let manifest;
  try {
    manifest = JSON.parse(await shell(`cat ${extensionPath}/manifest.json`));
  } catch (cause) {
    throw new Error(`Cannot read extension manifest at ${extensionPath}`, { cause });
  }
  // MV3 by itself is not enough: only declarativeNetRequest with static
  // rule_resources needs to write generated_indexed_rulesets on install.
  const ruleResources = manifest.declarative_net_request?.rule_resources;
  if (!Array.isArray(ruleResources) || ruleResources.length === 0) {
    return extensionPath;
  }

  const suffix = createHash('sha256').update(extensionPath).digest('hex').slice(0, 20);
  const parent = `/data/data/${packageName}/files/afterbird-unpacked`;
  const destination = `${parent}/${suffix}`;
  // Commands and paths are restricted to trusted package/path tokens above.
  // Keep this within run-as: app-owned _metadata must remain writable by the
  // browser. Never chown or chmod /data/local/tmp (shared shell-owned state).
  const command = `mkdir -p ${parent} && rm -rf ${destination} && cp -R ${extensionPath} ${destination}`;
  try {
    await shell(`run-as ${packageName} sh -c '${command}'`);
  } catch (cause) {
    throw new Error(`Cannot stage DNR extension at ${extensionPath}. ` +
      `Use a debuggable test APK (run-as ${packageName}) and make the source readable.`,
      { cause });
  }
  return destination;
}
