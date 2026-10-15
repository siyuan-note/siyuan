const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("the aggregate build cleans generated bundles before rebuilding", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    assert.equal(pkg.scripts["clean:stage"], undefined);
    assert.match(pkg.scripts.build, /^node scripts\/clean-stage\.mjs && /);
});

test("cleanStageBuild removes the whole output tree and ignores a missing directory", async () => {
    const {cleanStageBuild} = await import("./clean-stage.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-clean-stage-"));
    try {
        const buildDir = path.join(root, "stage", "build");
        fs.mkdirSync(path.join(buildDir, "map"), {recursive: true});
        fs.writeFileSync(path.join(buildDir, "map", "maplibre-gl.js"), "stale");
        fs.mkdirSync(path.join(buildDir, "app"), {recursive: true});
        fs.writeFileSync(path.join(buildDir, "app", "index.html"), "bundle");

        assert.equal(cleanStageBuild(buildDir), true);
        assert.equal(fs.existsSync(buildDir), false);
        assert.equal(cleanStageBuild(buildDir), false);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("cleanStageBuild preserves a linked directory", async (t) => {
    const {cleanStageBuild} = await import("./clean-stage.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-clean-stage-"));
    try {
        const target = path.join(root, "target");
        fs.mkdirSync(target, {recursive: true});
        fs.writeFileSync(path.join(target, "keep.txt"), "keep");
        const link = path.join(root, "linked");
        try {
            fs.symlinkSync(target, link, "junction");
        } catch (error) {
            t.skip("symlink unavailable: " + error.message);
            return;
        }

        assert.equal(cleanStageBuild(link), false);
        assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "keep");
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
