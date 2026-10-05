const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const originalOpen = fs.open;
const originalClose = fs.close;
let active = 0;
let exhausted = 0;
fs.open = (...args) => {
  const callback = args.pop();
  if (active >= 4) {
    exhausted++;
    return queueMicrotask(() => callback(Object.assign(new Error("fixture descriptor limit"), { code: "EMFILE" })));
  }
  active++;
  originalOpen(...args, (error, fd) => { if (error) active--; callback(error, fd); });
};
fs.close = (fd, callback) => originalClose(fd, error => { if (!error) active--; callback(error); });
require("../scripts/mac-signing-fs.cjs");
const { isBinaryFile } = require("isbinaryfile");
Promise.all(Array.from({ length: 32 }, () => isBinaryFile(path.join(__dirname, "../build/icon.ico")))).then(async results => {
  // isbinaryfile resolves before its asynchronous close callbacks finish.
  const deadline = Date.now() + 5000;
  while (active && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.ok(results.every(Boolean));
  assert.ok(exhausted > 0, "fixture must exhaust descriptors");
  assert.equal(active, 0, "all binary-scan descriptors must close");
  console.log(`Signing scan recovered from ${exhausted} descriptor-limit errors and closed all files.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
