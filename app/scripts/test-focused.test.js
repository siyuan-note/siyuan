const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {test} = require("node:test");
const {focusedFiles, focusedArguments} = require("./test-focused.mjs");

const fixture = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-focused-"));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const file = path.join(root, "路径 with spaces.test.js");
    fs.writeFileSync(file, 'require("node:test")("selected fixture", () => {});');
    return {root, file};
};

test("focused selection validates every file, deduplicates and never adds discovery globs", t => {
    const {root, file} = fixture(t);
    assert.deepEqual(focusedFiles(["--", file, file]), [file]);
    assert.deepEqual(focusedArguments([file]).slice(5), [file]);
    for (const files of [[], [root], ["missing.test.js"], ["*.test.js"], ["--test"], [file, "missing.test.js"]]) {
        assert.throws(() => focusedFiles(files));
    }
});

test("focused CLI runs only the explicit file and propagates failure", t => {
    const {root, file} = fixture(t);
    fs.writeFileSync(path.join(root, "neighbor.test.js"), 'throw new Error("must not run neighbor");');
    const runner = path.join(__dirname, "test-focused.mjs");
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const run = files => spawnSync(process.execPath, [runner, ...files], {
        cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 15000, env,
    });
    const result = run([file]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /selected fixture/);
    assert.doesNotMatch(result.stdout + result.stderr, /must not run neighbor/);
    const esm = path.join(root, "module.test.mjs");
    fs.writeFileSync(esm, 'import {test} from "node:test"; test("ESM fixture", () => {});');
    assert.equal(run([esm]).status, 0);
    const invalid = run([file, path.join(root, "missing.test.js")]);
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stdout, /selected fixture/);
    fs.writeFileSync(file, 'throw new Error("selected failure");');
    assert.equal(run([file]).status, 1);
});
