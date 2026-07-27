import test from "node:test";
import assert from "node:assert/strict";
import { assertAllowedUrl, compareVersions, validateReleaseManifest } from "../src/updater.mjs";

test("semantic versions compare without lexical mistakes", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.0.0", "2.0.0"), -1);
});

test("update URLs are restricted to HTTPS GitHub hosts", () => {
  assert.equal(assertAllowedUrl("https://github.com/gaboopa/releases/download/v1/app.exe").hostname, "github.com");
  assert.throws(() => assertAllowedUrl("http://github.com/file"));
  assert.throws(() => assertAllowedUrl("https://github.com.evil.example/file"));
});

test("release manifest selects the requested platform and requires revisions", () => {
  const value = { schemaVersion: 1, version: "1.2.3", sourceRevisions: { game: "a", assets: "b", locales: "c" }, artifacts: [{ platform: "windows", arch: "x64", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v1/app.exe" }] };
  assert.equal(validateReleaseManifest(value, "windows", "x64").artifact.size, 10);
  assert.throws(() => validateReleaseManifest(value, "macos", "arm64"));
});
