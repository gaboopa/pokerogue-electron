import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("Windows packaging keeps one stable per-user upgrade identity", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.build.appId, "com.gaboopa.pokerogueoffline");
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.ok(packageJson.build.files.includes("build/icon.ico"));
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.include, "build/installer.nsh");
  assert.equal(packageJson.build.nsis.installerIcon, "build/icon.ico");
  assert.equal(packageJson.build.nsis.uninstallerIcon, "build/icon.ico");
  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.nsis.uninstallDisplayName, "PokeRogue Offline");
});

test("Windows icon includes the complete desktop icon size set", async () => {
  const iconUrl = new URL("../build/icon.ico", import.meta.url);
  await access(iconUrl);
  const icon = await readFile(iconUrl);
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const imageCount = icon.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < imageCount; index += 1) {
    const offset = 6 + (index * 16);
    const width = icon[offset] || 256;
    const height = icon[offset + 1] || 256;
    const bitsPerPixel = icon.readUInt16LE(offset + 6);
    sizes.push(`${width}x${height}@${bitsPerPixel}`);
  }
  assert.deepEqual(sizes, [
    "16x16@32",
    "24x24@32",
    "32x32@32",
    "48x48@32",
    "64x64@32",
    "128x128@32",
    "256x256@32",
  ]);
});
test("Windows installer uses the supplied artwork on welcome and finish pages", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.build.nsis.installerSidebar, "build/installerSidebar.bmp");
  const sidebar = await readFile(new URL("../build/installerSidebar.bmp", import.meta.url));
  assert.equal(sidebar.toString("ascii", 0, 2), "BM");
  assert.equal(sidebar.readInt32LE(18), 164);
  assert.equal(sidebar.readInt32LE(22), 314);
});
test("Windows installer welcome explains the current offline release", async () => {
  const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(installer, /MUI_WELCOMEPAGE_TITLE "Ready to install PokeRogue Offline\?"/);
  assert.ok(installer.includes(
    'MUI_WELCOMEPAGE_TEXT "Click Next to begin setting up a new offline version of PokeRogue on your PC. It only takes a few moments.$\\r$\\n$\\r$\\nPlease verify you\'re installing the latest version! This is version: ${VERSION}"',
  ));
  assert.match(installer, /!insertmacro MUI_PAGE_WELCOME/);
  assert.doesNotMatch(installer, /Hi, it takes a bit of time|Starting PokeRogue Offline Setup|InstallerWelcomePageShow|SpiderBanner::Show|MUI_CUSTOMFUNCTION_GUIINIT/);
});
test("Windows installer progress page uses the header and native current-file text", async () => {
  const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  const installText = "You are now installing an electron-based wrapper for the online game PokeRogue! This install is entirely offline gameplay.";
  const escapedText = installText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(installer, /GetDlgItem \$1 \$HWNDPARENT 1037/);
  assert.match(installer, /GetDlgItem \$1 \$HWNDPARENT 1038/);
  assert.match(installer, new RegExp(`WM_SETTEXT} 0 "STR:${escapedText}"`));
  assert.doesNotMatch(installer, /MUI_INSTFILESPAGE_TEXT/);
  assert.match(installer, /FindWindow \$0 "#32770"/);
  assert.match(installer, /GetDlgItem \$1 \$0 1006/);
  assert.match(installer, /GetDlgItem \$InstallerProgressBar \$0 1004/);
  assert.match(installer, /PBM_GETPOS/);
  assert.match(installer, /\[Now\] Installing/);
  assert.match(installer, /STR:100%/);
  assert.doesNotMatch(installer, /SetWindowPos\(p \$InstallerProgressBar/);
  assert.match(installer, /CreateWindowExW\(i 0, w "STATIC", w "\[Done\] Starting/);
  assert.match(installer, /CreateWindowExW\(i 0, w "STATIC", w "Installing application files"/);
  assert.doesNotMatch(installer, /Preparing installation/);
});
