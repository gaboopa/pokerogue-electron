import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { assertAllowedUrl, assertValidRelease } from "./release-contract.mjs";

export function compareVersions(a, b) {
  const parse = value => {
    const match = String(value).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) throw new Error(`Invalid semantic version: ${value}`);
    return match.slice(1).map(Number);
  };
  const left = parse(a); const right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fetchAllowed(url, options = {}, redirects = 0) {
  const checked = assertAllowedUrl(url);
  const response = await fetch(checked, { ...options, redirect: "manual", headers: { "user-agent": "PokeRogue-Offline-Updater", accept: "application/vnd.github+json", ...options.headers } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 4) throw new Error("Too many update redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Update redirect had no destination");
    return fetchAllowed(new URL(location, checked).href, options, redirects + 1);
  }
  if (!response.ok) throw new Error(`Update request failed (${response.status})`);
  return response;
}

export function validateReleaseManifest(value, expectedPlatform, expectedArch) {
  assertValidRelease(value);
  const artifact = value.artifacts.find(item => item.platform === expectedPlatform && item.arch === expectedArch);
  if (!artifact) throw new Error("No valid update artifact for this platform");
  return { manifest: value, artifact };
}

export async function checkForUpdate(repository, currentVersion, platform, arch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid update repository");
  const release = await (await fetchAllowed(`https://api.github.com/repos/${repository}/releases/latest`, { signal: AbortSignal.timeout(30000) })).json();
  const manifestAsset = release.assets?.find(asset => asset.name === "release-manifest.json");
  if (!manifestAsset) throw new Error("Release does not include release-manifest.json");
  const raw = await (await fetchAllowed(manifestAsset.browser_download_url, { signal: AbortSignal.timeout(30000) })).json();
  const result = validateReleaseManifest(raw, platform, arch);
  return { ...result, available: compareVersions(raw.version, currentVersion) > 0 };
}

const destinationQueues = new Map();

function withDestinationLock(destination, operation) {
  const previous = destinationQueues.get(destination) ?? Promise.resolve();
  let release;
  const current = new Promise(resolveLock => { release = resolveLock; });
  const tail = previous.then(() => current);
  destinationQueues.set(destination, tail);

  return previous.then(operation).finally(() => {
    release();
    if (destinationQueues.get(destination) === tail) destinationQueues.delete(destination);
  });
}

async function matchesArtifact(path, artifact, statFile) {
  let file;
  try {
    file = await statFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (file.size !== artifact.size) return false;

  return (await sha256File(path)).toLowerCase() === artifact.sha256.toLowerCase();
}

export async function downloadVerified(artifact, destinationRoot, fileOperations = {}) {
  const signal = fileOperations.signal;
  if (signal?.aborted) throw Object.assign(new Error("Update download cancelled"), { code: "UPDATE_CANCELLED" });
  const statFile = fileOperations.stat ?? stat;
  const renameFile = fileOperations.rename ?? rename;
  const writeStreamFor = fileOperations.writeStream ?? (handle => handle.createWriteStream());
  const stallTimeoutMs = fileOperations.stallTimeoutMs ?? 60000;
  await mkdir(destinationRoot, { recursive: true });
  const finalPath = resolve(destinationRoot, basename(new URL(artifact.downloadUrl).pathname));

  return withDestinationLock(finalPath, async () => {
    if (signal?.aborted) throw Object.assign(new Error("Update download cancelled"), { code: "UPDATE_CANCELLED" });
    if (await matchesArtifact(finalPath, artifact, statFile)) return finalPath;
    try {
      await statFile(finalPath);
      throw new Error("A different verified artifact already occupies this download path");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const partialPath = `${finalPath}.${randomUUID()}.partial`;
    let ownsPartial = false;
    let fileHandle;
    const controller = new AbortController();
    let stallTimer;
    const cancel = () => controller.abort(Object.assign(new Error("Update download cancelled"), { code: "UPDATE_CANCELLED" }));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(new Error(`Update download stalled: no data received for ${stallTimeoutMs / 1000} seconds`)), stallTimeoutMs);
    };
    try {
      armStall();
      const response = await fetchAllowed(artifact.downloadUrl, { headers: { accept: "application/octet-stream" }, signal: controller.signal });
      const hash = createHash("sha256");
      let received = 0;
      const transform = new TransformStream({ transform(chunk, out) { armStall(); hash.update(chunk); received += chunk.byteLength; fileOperations.onProgress?.(received, artifact.size); out.enqueue(chunk); } });
      fileHandle = await open(partialPath, "wx");
      ownsPartial = true;
      await pipeline(response.body.pipeThrough(transform), writeStreamFor(fileHandle));
      if (controller.signal.aborted) throw controller.signal.reason;
      const size = (await statFile(partialPath)).size;
      if (size !== artifact.size || hash.digest("hex").toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new Error("Downloaded update failed verification");
      }
      await renameFile(partialPath, finalPath);
      ownsPartial = false;
      return finalPath;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      clearTimeout(stallTimer);
      if (fileHandle) await fileHandle.close().catch(() => {});
      if (ownsPartial) await rm(partialPath, { force: true });
    }
  });
}
