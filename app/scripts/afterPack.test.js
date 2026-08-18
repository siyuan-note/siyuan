const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {Arch} = require("electron-builder");
const {extractPackagedPandoc} = require("./afterPack");

const PANDOC_ZIP = "UEsDBBQAAAAIAFxK/lz1kGVQDQAAAAsAAAAOAAAAYmluL3BhbmRvYy5leGUrSS0u0S1IzEvJTwYAUEsDBBQAAAAIAFxK/lzzFYE4CwAAAAkAAAANAAAAQ09QWVJJR0hULnR4dEvOL6gsykzPKAEAUEsBAhQAFAAAAAgAXEr+XPWQZVANAAAACwAAAA4AAAAAAAAAAAAAAIABAAAAAGJpbi9wYW5kb2MuZXhlUEsBAhQAFAAAAAgAXEr+XPMVgTgLAAAACQAAAA0AAAAAAAAAAAAAAIABOQAAAENPUFlSSUdIVC50eHRQSwUGAAAAAAIAAgB3AAAAbwAAAAAA";

test("extractPackagedPandoc extracts the executable and removes the archive", async () => {
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-after-pack-"));
  try {
    const resourcesDir = path.join(appOutDir, "resources");
    await fs.mkdir(resourcesDir, {recursive: true});
    await fs.writeFile(path.join(resourcesDir, "pandoc.zip"), Buffer.from(PANDOC_ZIP, "base64"));

    await extractPackagedPandoc(appOutDir, {appInfo: {productFilename: "SiYuan"}}, "win32", Arch.x64);

    assert.equal(await fs.readFile(path.join(resourcesDir, "pandoc", "bin", "pandoc.exe"), "utf8"), "test-pandoc");
    assert.equal(await fs.readFile(path.join(resourcesDir, "pandoc", "COPYRIGHT.txt"), "utf8"), "copyright");
    await assert.rejects(fs.access(path.join(resourcesDir, "pandoc.zip")));
  } finally {
    await fs.rm(appOutDir, {force: true, recursive: true});
  }
});

test("extractPackagedPandoc skips Windows ARM64 without an archive", async () => {
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-after-pack-"));
  try {
    await fs.mkdir(path.join(appOutDir, "resources"), {recursive: true});
    await extractPackagedPandoc(appOutDir, {appInfo: {productFilename: "SiYuan"}}, "win32", Arch.arm64);
  } finally {
    await fs.rm(appOutDir, {force: true, recursive: true});
  }
});

test("extractPackagedPandoc rejects a missing archive for supported targets", async () => {
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-after-pack-"));
  try {
    await fs.mkdir(path.join(appOutDir, "resources"), {recursive: true});
    await assert.rejects(
      extractPackagedPandoc(appOutDir, {appInfo: {productFilename: "SiYuan"}}, "win32", Arch.x64),
      /Packaged Pandoc archive not found/
    );
  } finally {
    await fs.rm(appOutDir, {force: true, recursive: true});
  }
});
