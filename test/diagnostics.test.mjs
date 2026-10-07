import test from "node:test";
import assert from "node:assert/strict";
import { formatDiagnosticReport, summarizeBackups } from "../src/diagnostics.mjs";
import { createMenuTemplate } from "../src/menu.mjs";

const completeFacts = () => ({
  version: "0.1.4", packaged: true, platform: "win32", arch: "x64", osVersion: "Windows 10.0.26200",
  electron: "42.11.10", chrome: "130.0.6723.44", node: "22.15.1",
  revisions: { game: "a".repeat(40), assets: "b".repeat(40), locales: "c".repeat(40) },
  profileName: null, profileCount: 2,
  backups: { count: 7, latest: "2026-10-06T21-11-04.123Z", operation: "update" },
  pending: null,
});

test("formats a complete diagnostic report exactly", () => {
  assert.equal(formatDiagnosticReport(completeFacts()), [
    "PokeRogue Offline diagnostic report",
    "Version: 0.1.4 (packaged)",
    "Platform: win32 x64, Windows 10.0.26200",
    "Electron 42.11.10, Chrome 130.0.6723.44, Node 22.15.1",
    `Game revision: ${"a".repeat(40)}`,
    `Assets revision: ${"b".repeat(40)}`,
    `Locales revision: ${"c".repeat(40)}`,
    "Profile: default (2 profiles)",
    "Backups: 7, latest 2026-10-06T21-11-04.123Z (update)",
    "Pending operation: none",
  ].join("\n"));
});

test("prints unavailable revisions and zero Backups", () => {
  const facts = completeFacts();
  facts.revisions = {};
  facts.backups = { count: 0 };
  const report = formatDiagnosticReport(facts);
  assert.match(report, /Game revision: unavailable/);
  assert.match(report, /Assets revision: unavailable/);
  assert.match(report, /Locales revision: unavailable/);
  assert.match(report, /Backups: 0/);
});

test("Backup summary counts recognised names and reports the newest", () => {
  const token = "ab12cd34";
  assert.deepEqual(summarizeBackups([`backup-2026-10-05T10-00-00.000Z-manual-${token}`, "notes", `backup-2026-10-06T21-11-04.123Z-update-${token}`]), { count: 2, latest: "2026-10-06T21-11-04.123Z", operation: "update" });
  assert.deepEqual(summarizeBackups([]), { count: 0 });
});

test("a named Profile is anonymized and unused facts are not copied", () => {
  const facts = { ...completeFacts(), profileName: "Player Secret", unusedProfileName: "Other Secret", privatePath: "C:\\Users\\Player Secret\\Save data" };
  const report = formatDiagnosticReport(facts);
  assert.match(report, /Profile: named \(2 profiles\)/);
  assert.doesNotMatch(report, /Player Secret|Other Secret|C:\\Users|Save data/);
});

test("Copy Diagnostic Report follows Open Save Folder in the application menu", () => {
  const menu = createMenuTemplate({
    isMac: false, productName: "PokeRogue Offline", onCheckForUpdates() {}, onBackup() {}, onRestore() {},
    onOpenSaveFolder() {}, onCopyDiagnosticReport() {}, onReload() {}, onToggleFullscreen() {}, onDeveloperTools() {},
    utilities: [], keybindings: [], cheats: [],
  });
  const labels = menu[0].submenu.map(item => item.label);
  assert.equal(labels.indexOf("Copy Diagnostic Report"), labels.indexOf("Open Save Folder") + 1);
});
