import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const profileNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,30}[A-Za-z0-9])?$/;
const reservedNamePattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function profileNameError(name) {
  if (typeof name !== "string" || !profileNamePattern.test(name)) return "Use 1–32 letters, digits, spaces, hyphens or underscores, starting and ending with a letter or digit.";
  if (name.toLowerCase() === "default" || reservedNamePattern.test(name)) return "That name is reserved.";
  return null;
}

export function assertValidProfileName(name) {
  const error = profileNameError(name);
  if (error) throw new Error(error);
  return name;
}

function profilesDirectory(root) {
  return join(resolve(root), "Profiles");
}

function assertDirectChild(directory, profilesRoot, name) {
  const resolvedDirectory = resolve(directory);
  const childPath = relative(resolve(profilesRoot), resolvedDirectory);
  if (dirname(resolvedDirectory) !== resolve(profilesRoot) || childPath !== name || basename(resolvedDirectory) !== name) {
    throw new Error("Resolved profile directory is not a direct child of Profiles");
  }
  return resolvedDirectory;
}

function defaultProfile(root) {
  return { root, name: null, directory: root };
}

function reportFallback(reason) {
  process.stderr.write(`Could not resolve active profile: ${reason}\n`);
}

export function resolveActiveProfile(root) {
  const resolvedRoot = resolve(root);
  const activePath = join(resolvedRoot, "active-profile.json");
  let document;
  try { document = JSON.parse(readFileSync(activePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return defaultProfile(resolvedRoot);
    reportFallback(error instanceof SyntaxError ? "active-profile.json is malformed" : `active-profile.json is unreadable: ${error.message}`);
    return defaultProfile(resolvedRoot);
  }

  if (!document || typeof document !== "object" || Array.isArray(document) || document.schemaVersion !== 1 ||
      Object.keys(document).length !== 2 || !Object.hasOwn(document, "profile")) {
    reportFallback("active-profile.json has an unsupported shape or schema version");
    return defaultProfile(resolvedRoot);
  }
  if (document.profile === null) return defaultProfile(resolvedRoot);
  const invalidName = profileNameError(document.profile);
  if (invalidName) {
    reportFallback(`active profile name is invalid: ${invalidName}`);
    return defaultProfile(resolvedRoot);
  }

  const profilesRoot = profilesDirectory(resolvedRoot);
  const directory = assertDirectChild(join(profilesRoot, document.profile), profilesRoot, document.profile);
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      reportFallback(`active profile directory is not a real directory: ${document.profile}`);
      return defaultProfile(resolvedRoot);
    }
  } catch (error) {
    reportFallback(error.code === "ENOENT"
      ? `active profile directory is missing: ${document.profile}`
      : `active profile directory could not be checked: ${error.message}`);
    return defaultProfile(resolvedRoot);
  }
  return { root: resolvedRoot, name: document.profile, directory };
}

export function listProfiles(root) {
  const directory = profilesDirectory(root);
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return entries
    .filter(entry => !profileNameError(entry.name))
    .filter(entry => {
      try {
        const info = lstatSync(join(directory, entry.name));
        return info.isDirectory() && !info.isSymbolicLink();
      } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    })
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function createProfile(root, name) {
  assertValidProfileName(name);
  if (listProfiles(root).some(existing => existing.toLowerCase() === name.toLowerCase())) {
    throw new Error("A profile with that name already exists.");
  }
  const directory = profilesDirectory(root);
  mkdirSync(directory, { recursive: true });
  const profileDirectory = assertDirectChild(join(directory, name), directory, name);
  mkdirSync(profileDirectory, { recursive: false });
  return profileDirectory;
}

export function setActiveProfile(root, name) {
  if (name !== null) assertValidProfileName(name);
  const resolvedRoot = resolve(root);
  if (name !== null) {
    const directory = assertDirectChild(join(profilesDirectory(resolvedRoot), name), profilesDirectory(resolvedRoot), name);
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Active profile must be a real directory");
  }
  const path = join(resolvedRoot, "active-profile.json");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, profile: name }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
