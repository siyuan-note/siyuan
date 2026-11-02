import {readEnabledSetting, writeEnabledSetting} from "./enabledSettingFile";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const withDirectory = (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-enabled-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return directory;
};

test("missing setting files read as disabled", (t) => {
    assert.equal(readEnabledSetting(path.join(withDirectory(t), "absent.json")), false);
});

test("invalid content is rejected without touching the existing file", (t) => {
    const file = path.join(withDirectory(t), "setting.json");
    for (const content of ["{", "null", "[]", "{}", '{"enabled":"true"}', '{"enabled":1}']) {
        fs.writeFileSync(file, content);
        assert.throws(() => readEnabledSetting(file), Error);
        assert.equal(fs.readFileSync(file, "utf8"), content);
    }
    // 路径指向目录时不能当作空设置返回，否则会静默关闭用户的偏好。
    assert.throws(() => readEnabledSetting(path.dirname(file)), Error);
});

test("writing replaces the file atomically and leaves no temporary files", (t) => {
    const directory = withDirectory(t);
    const file = path.join(directory, "setting.json");
    writeEnabledSetting(file, true);
    assert.equal(readEnabledSetting(file), true);
    writeEnabledSetting(file, false);
    assert.equal(readEnabledSetting(file), false);
    assert.deepEqual(fs.readdirSync(directory), ["setting.json"]);
});

test("failed writes keep the previous value", (t) => {
    const directory = withDirectory(t);
    const file = path.join(directory, "setting.json");
    writeEnabledSetting(file, true);
    t.mock.method(fs, "renameSync", () => { throw new Error("write failed"); });
    assert.throws(() => writeEnabledSetting(file, false), /write failed/);
    assert.equal(readEnabledSetting(file), true);
    assert.deepEqual(fs.readdirSync(directory), ["setting.json"]);
});

test("non-boolean values are refused before touching the filesystem", (t) => {
    const file = path.join(withDirectory(t), "setting.json");
    // 这些值故意违反签名：用例验证运行期校验不依赖类型系统。
    const invalidValues: unknown[] = [undefined, null, "true", 0, 1, {}];
    for (const value of invalidValues) {
        assert.throws(() => writeEnabledSetting(file, value as boolean), TypeError);
    }
    assert.equal(fs.existsSync(file), false);
});
