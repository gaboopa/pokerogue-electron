import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertValidProfileName, createProfile, listProfiles, profileNameError, resolveActiveProfile, setActiveProfile } from "../src/profiles.mjs";

test("profile names accept the allowed form and reject invalid and reserved names", () => {
  for (const name of ["A", "Clean", "clean run", "clean_run", "clean-run", `a${"b".repeat(30)}z`]) assert.equal(assertValidProfileName(name), name);
  for (const name of ["", " ", " clean", "clean ", "_clean", "clean-", "a/b", "a\\b", "a.b", "a".repeat(33), "Default", "dEfAuLt", "CON", "prn", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
    assert.ok(profileNameError(name), JSON.stringify(name));
    assert.throws(() => assertValidProfileName(name));
  }
});

test("profile resolution defaults safely for absent and invalid active profile data", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-profiles-resolve-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fallbacks = [
    ["malformed JSON", "{"],
    ["invalid name", JSON.stringify({ schemaVersion: 1, profile: "../escape" })],
    ["missing directory", JSON.stringify({ schemaVersion: 1, profile: "Missing" })],
  ];

  assert.deepEqual(resolveActiveProfile(root), { root, name: null, directory: root });
  await assert.rejects(lstat(join(root, "Profiles")), { code: "ENOENT" });
  for (const [reason, content] of fallbacks) {
    await writeFile(join(root, "active-profile.json"), content);
    const output = [];
    t.mock.method(process.stderr, "write", value => { output.push(String(value)); return true; });
    assert.deepEqual(resolveActiveProfile(root), { root, name: null, directory: root }, reason);
    assert.equal(output.length, 1, reason);
    assert.match(output[0], /Could not resolve active profile:/, reason);
    t.mock.restoreAll();
    if (reason === "missing directory") await assert.rejects(lstat(join(root, "Profiles", "Missing")), { code: "ENOENT" });
  }

  const profiles = join(root, "Profiles");
  await mkdir(profiles);
  const target = join(root, "target");
  await mkdir(target);
  await symlink(target, join(profiles, "Linked"), "junction");
  await writeFile(join(root, "active-profile.json"), JSON.stringify({ schemaVersion: 1, profile: "Linked" }));
  const output = [];
  t.mock.method(process.stderr, "write", value => { output.push(String(value)); return true; });
  assert.deepEqual(resolveActiveProfile(root), { root, name: null, directory: root });
  assert.equal(output.length, 1);
  t.mock.restoreAll();
  assert.deepEqual((await readdir(profiles)).sort(), ["Linked"]);
});

test("creating and activating a profile round-trips through resolution", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-profiles-roundtrip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = createProfile(root, "Clean Run");
  await assert.rejects(Promise.resolve().then(() => createProfile(root, "clean run")), /A profile with that name already exists\./);
  setActiveProfile(root, "Clean Run");
  assert.deepEqual(resolveActiveProfile(root), { root, name: "Clean Run", directory });
  setActiveProfile(root, null);
  assert.deepEqual(resolveActiveProfile(root), { root, name: null, directory: root });
  assert.equal(JSON.parse(await readFile(join(root, "active-profile.json"), "utf8")).profile, null);
});

test("profile listing includes sorted valid real directories only", async t => {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-profiles-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profiles = join(root, "Profiles");
  await mkdir(profiles);
  await mkdir(join(profiles, "zeta"));
  await mkdir(join(profiles, "Alpha"));
  await mkdir(join(profiles, "Default"));
  await mkdir(join(profiles, "bad.name"));
  await writeFile(join(profiles, "Readme.txt"), "ignored");
  const target = join(root, "target");
  await mkdir(target);
  await symlink(target, join(profiles, "Linked"), "junction");
  assert.deepEqual(listProfiles(root), ["Alpha", "zeta"]);
});
