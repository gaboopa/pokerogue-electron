import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, downloadVerified, validateReleaseManifest } from "../src/updater.mjs";
import { currentUpdateStep, formatUpdateProgress } from "../src/update-window/progress.mjs";
import { assertAllowedUrl } from "../src/release-contract.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const artifact = (bytes, downloadUrl = "https://github.com/gaboopa/releases/download/v1/app.dmg") => ({ downloadUrl, size: Buffer.byteLength(bytes), sha256: digest(bytes) });
const responseFor = bytes => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(bytes)); controller.close(); } }));

async function withDownloadRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "pokerogue-update-"));
  const originalFetch = globalThis.fetch;
  try {
    await run(root, setFetch => { globalThis.fetch = setFetch; });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
}

async function partialFiles(root) {
  return (await readdir(root)).filter(name => name.endsWith(".partial"));
}

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
  const value = { schemaVersion: 1, version: "1.2.3", sourceRevisions: { game: "a", assets: "b", locales: "c" }, artifacts: [{ platform: "windows", arch: "x64", fileName: "PokeRogue-Offline-1.2.3-windows-x64.exe", size: 10, sha256: "a".repeat(64), downloadUrl: "https://github.com/gaboopa/pokerogue-electron/releases/download/v1/app.exe" }] };
  assert.equal(validateReleaseManifest(value, "windows", "x64").artifact.size, 10);
  assert.throws(() => validateReleaseManifest(value, "macos", "arm64"));
  assert.throws(() => validateReleaseManifest({ ...value, version: "" }, "windows", "x64"), /Malformed/);
  assert.throws(() => validateReleaseManifest({ ...value, sourceRevisions: { game: "a", assets: "", locales: "c" } }, "windows", "x64"), /source revision assets/);
});

test("overlapping same-destination downloads return only bytes matching their verified hash", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    let releaseFirstChunk;
    let firstChunkStarted;
    const firstStarted = new Promise(resolve => { firstChunkStarted = resolve; });
    const firstMayFinish = new Promise(resolve => { releaseFirstChunk = resolve; });
    let fetchCount = 0;
    setFetch(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(Buffer.from("AAAA"));
            firstChunkStarted();
            await firstMayFinish;
            controller.enqueue(Buffer.from("BBBB"));
            controller.close();
          }
        }));
      }
      return responseFor("XXXXXXXX");
    });

    const expected = artifact("AAAABBBB");
    const first = downloadVerified(expected, root);
    await firstStarted;
    const second = downloadVerified(expected, root);
    releaseFirstChunk();

    const [returnedPath, secondResult] = await Promise.all([first, second]);
    assert.equal(secondResult, returnedPath);
    assert.equal(digest(await readFile(returnedPath)), expected.sha256);
    assert.equal(await readFile(returnedPath, "utf8"), "AAAABBBB");
    assert.equal(fetchCount, 1);
  });
});

test("same-basename artifact collisions preserve the first verified file", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    setFetch(async request => responseFor(new URL(request.url ?? request).searchParams.get("data")));
    const firstArtifact = artifact("AAAABBBB", "https://github.com/gaboopa/releases/download/v1/app.dmg?data=AAAABBBB");
    const differentArtifact = artifact("XXXXXXXX", "https://github.com/gaboopa/releases/download/v2/app.dmg?data=XXXXXXXX");
    const returnedPath = await downloadVerified(firstArtifact, root);

    await assert.rejects(downloadVerified(differentArtifact, root), /different verified artifact/i);
    assert.equal(digest(await readFile(returnedPath)), firstArtifact.sha256);
  });
});

test("failed streams and verification errors remove only their owned partial and allow retry", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    let attempts = 0;
    setFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("AAAA")); controller.error(new Error("connection reset")); } }));
      }
      return responseFor("AAAABBBB");
    });
    const expected = artifact("AAAABBBB");

    await assert.rejects(downloadVerified(expected, root), /connection reset/);
    assert.deepEqual(await partialFiles(root), []);
    const returnedPath = await downloadVerified(expected, root);
    assert.equal(digest(await readFile(returnedPath)), expected.sha256);

    setFetch(async () => responseFor("XXXXXXXX"));
    await assert.rejects(downloadVerified(expected, join(root, "bad-hash")), /failed verification/);
    assert.deepEqual(await partialFiles(join(root, "bad-hash")), []);
    await assert.rejects(downloadVerified({ ...expected, size: expected.size + 1 }, join(root, "bad-size")), /failed verification/);
    assert.deepEqual(await partialFiles(join(root, "bad-size")), []);
  });
});

test("disk-write, stat, and promotion failures clean their partial files", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    setFetch(async () => responseFor("AAAABBBB"));
    const expected = artifact("AAAABBBB");
    const failedOperations = [
      ["disk write", { writeStream: () => new Writable({ write(_chunk, _encoding, callback) { callback(new Error("disk full")); } }) }, /disk full/],
      ["stat", { stat: async path => { if (path.endsWith(".partial")) throw new Error("stat failed"); return (await import("node:fs/promises")).stat(path); } }, /stat failed/],
      ["rename", { rename: async () => { throw new Error("promotion failed"); } }, /promotion failed/],
    ];

    for (const [name, operations, error] of failedOperations) {
      const directory = join(root, name.replaceAll(" ", "-"));
      await assert.rejects(downloadVerified(expected, directory, operations), error);
      assert.deepEqual(await partialFiles(directory), []);
    }
  });
});

test("failed cleanup leaves another destination's partial intact and does not block it", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    let releaseSecond;
    let announceSecondWriter;
    const secondWriterStarted = new Promise(resolve => { announceSecondWriter = resolve; });
    const secondMayFinish = new Promise(resolve => { releaseSecond = resolve; });
    let writersStarted = 0;
    setFetch(async request => {
      if (new URL(request).pathname.endsWith("app.dmg")) {
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error("first destination failed")); } }));
      }
      return new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(Buffer.from("independent"));
          await secondMayFinish;
          controller.close();
        }
      }));
    });

    const fileOperations = { writeStream: handle => {
      writersStarted++;
      if (writersStarted === 2) announceSecondWriter();
      return handle.createWriteStream();
    } };
    const secondRoot = join(root, "other-destination");
    const first = downloadVerified(artifact("AAAABBBB"), root, fileOperations);
    const second = downloadVerified(artifact("independent", "https://github.com/gaboopa/releases/download/v1/other.zip"), secondRoot, fileOperations);
    await secondWriterStarted;
    assert.equal((await partialFiles(secondRoot)).length, 1);
    await assert.rejects(first, /first destination failed/);
    assert.equal((await partialFiles(secondRoot)).length, 1);
    releaseSecond();
    const independentPath = await second;
    assert.equal(await readFile(independentPath, "utf8"), "independent");
    assert.deepEqual(await partialFiles(secondRoot), []);
  });
});

test("a stalled download rejects with the stall message and leaves no partial", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    setFetch(async (_request, init) => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("AAAA")); init.signal.addEventListener("abort", () => controller.error(init.signal.reason)); } })));
    await assert.rejects(downloadVerified(artifact("AAAABBBB"), root, { stallTimeoutMs: 50 }), /Update download stalled: no data received for 0\.05 seconds/);
    assert.deepEqual(await partialFiles(root), []);
  });
});

test("an aborted download rejects as cancelled and leaves no file", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    const controller = new AbortController();
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    setFetch(async (_request, init) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(Buffer.from("AAAA"));
        requestStarted();
        init.signal.addEventListener("abort", () => stream.error(init.signal.reason));
      },
    })));
    const download = downloadVerified(artifact("AAAABBBB"), root, { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(download, error => error.code === "UPDATE_CANCELLED");
    assert.deepEqual(await readdir(root), []);
  });
});

test("an already-aborted download makes no request", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    setFetch(async () => { requests++; return responseFor("AAAABBBB"); });
    await assert.rejects(downloadVerified(artifact("AAAABBBB"), root, { signal: controller.signal }), error => error.code === "UPDATE_CANCELLED");
    assert.equal(requests, 0);
    assert.deepEqual(await readdir(root), []);
  });
});

test("update progress formatting and current step follow received bytes", () => {
  assert.deepEqual(formatUpdateProgress(58_000_000, 94_000_000), { percent: 62, size: "58 / 94 MB" });
  assert.equal(currentUpdateStep({ received: 58, total: 94 }), 0);
  assert.equal(currentUpdateStep({ received: 94, total: 94 }), 1);
});

test("progress reports increasing byte counts ending at the full size", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    setFetch(async () => new Response(new ReadableStream({ start(controller) { for (const part of ["AA", "BB", "CC"]) controller.enqueue(Buffer.from(part)); controller.close(); } })));
    const calls = [];
    await downloadVerified(artifact("AABBCC"), root, { onProgress: (received, total) => calls.push([received, total]) });
    assert.equal(calls.length > 0, true);
    assert.deepEqual(calls.map(call => call[0]), [...calls.map(call => call[0])].sort((a, b) => a - b));
    assert.equal(new Set(calls.map(call => call[0])).size, calls.length);
    assert.deepEqual(calls.at(-1), [6, 6]);
  });
});

test("a slow download that keeps delivering chunks outlives the stall timeout", async () => {
  await withDownloadRoot(async (root, setFetch) => {
    setFetch(async () => new Response(new ReadableStream({
      async start(controller) {
        for (const part of ["AA", "BB", "CC", "DD", "EE"]) {
          controller.enqueue(Buffer.from(part));
          await new Promise(done => setTimeout(done, 40));
        }
        controller.close();
      }
    })));
    const path = await downloadVerified(artifact("AABBCCDDEE"), root, { stallTimeoutMs: 100 });
    assert.equal(await readFile(path, "utf8"), "AABBCCDDEE");
  });
});
