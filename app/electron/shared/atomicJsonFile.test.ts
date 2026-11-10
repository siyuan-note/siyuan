import {test} from "node:test";
import {writeJsonAtomically} from "./atomicJsonFile";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const withDirectory = (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-atomic-json-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return directory;
};

test("writes the value and leaves no temporary file behind", (t) => {
    const directory = withDirectory(t);
    const file = path.join(directory, "nested", "setting.json");
    writeJsonAtomically(file, {enabled: true});
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {enabled: true});
    // 目标目录按需创建，且同目录下只剩目标文件。
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["setting.json"]);
});

test("indent is optional and only affects formatting", (t) => {
    const directory = withDirectory(t);
    const compact = path.join(directory, "compact.json");
    const indented = path.join(directory, "indented.json");
    writeJsonAtomically(compact, {a: 1});
    writeJsonAtomically(indented, {a: 1}, 2);
    assert.equal(fs.readFileSync(compact, "utf8"), '{"a":1}');
    assert.equal(fs.readFileSync(indented, "utf8"), '{\n  "a": 1\n}');
});

test("a failed replacement keeps the previous file and removes the temporary one", (t) => {
    const directory = withDirectory(t);
    const file = path.join(directory, "setting.json");
    writeJsonAtomically(file, {enabled: true});
    t.mock.method(fs, "renameSync", () => {
        throw new Error("write failed");
    });
    assert.throws(() => writeJsonAtomically(file, {enabled: false}), /write failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {enabled: true});
    assert.deepEqual(fs.readdirSync(directory), ["setting.json"]);
});
