import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";


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
