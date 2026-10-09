import test from "node:test";
import assert from "node:assert/strict";
import { dialogSize } from "../src/dialog-window/size.mjs";

test("dialog sizes round up and allow at most two overflow corrections", () => {
  assert.deepEqual(dialogSize(120.2), { height: 121, corrections: 0 });
  assert.deepEqual(dialogSize(121.1, 0, true), { height: 122, corrections: 1 });
  assert.deepEqual(dialogSize(122, 1, true), { height: 122, corrections: 2 });
  assert.equal(dialogSize(123, 2, true), null);
});
