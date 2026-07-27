import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ALLOWED_UPDATE_HOSTS } from "./constants.mjs";

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

export function assertAllowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_UPDATE_HOSTS.has(url.hostname)) throw new Error(`Update URL is not allowed: ${url.origin}`);
  return url;
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
  if (!value || value.schemaVersion !== 1 || typeof value.version !== "string" || !Array.isArray(value.artifacts)) throw new Error("Malformed release manifest");
  const artifact = value.artifacts.find(item => item.platform === expectedPlatform && item.arch === expectedArch);
  if (!artifact || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error("No valid update artifact for this platform");
  assertAllowedUrl(artifact.downloadUrl);
  if (!value.sourceRevisions?.game || !value.sourceRevisions?.assets || !value.sourceRevisions?.locales) throw new Error("Release source revisions are missing");
  return { manifest: value, artifact };
}

export async function checkForUpdate(repository, currentVersion, platform, arch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid update repository");
  const release = await (await fetchAllowed(`https://api.github.com/repos/${repository}/releases/latest`)).json();
  const manifestAsset = release.assets?.find(asset => asset.name === "release-manifest.json");
  if (!manifestAsset) throw new Error("Release does not include release-manifest.json");
  const raw = await (await fetchAllowed(manifestAsset.browser_download_url)).json();
  const result = validateReleaseManifest(raw, platform, arch);
  return { ...result, available: compareVersions(raw.version, currentVersion) > 0 };
}

export async function downloadVerified(artifact, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  const finalPath = join(destinationRoot, basename(new URL(artifact.downloadUrl).pathname));
  const partialPath = `${finalPath}.partial`;
  await rm(partialPath, { force: true });
  const response = await fetchAllowed(artifact.downloadUrl, { headers: { accept: "application/octet-stream" } });
  const hash = createHash("sha256");
  const transform = new TransformStream({ transform(chunk, controller) { hash.update(chunk); controller.enqueue(chunk); } });
  await pipeline(response.body.pipeThrough(transform), createWriteStream(partialPath));
  const size = (await stat(partialPath)).size;
  if (size !== artifact.size || hash.digest("hex").toLowerCase() !== artifact.sha256.toLowerCase()) {
    await rm(partialPath, { force: true });
    throw new Error("Downloaded update failed verification");
  }
  await rename(partialPath, finalPath);
  return finalPath;
}
