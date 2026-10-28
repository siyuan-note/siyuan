const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {selectTests, scanReferences} = require("./test-changed.mjs");

const fixture = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-test-changed-"));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (name, content) => {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, content);
        return target;
    };
    return {root, write};
};

test("module specifiers and source path literals are both treated as dependencies", () => {
    const references = scanReferences([
        'import {a} from "./a";',
        'const b = require("../b.ts");',
        'const text = readFileSync("src/c.ts", "utf8");',
        'const css = "src/d.scss";',
        'import("src/e.ts");',
        'const url = "https://example.com/x.ts";',
    ].join("\n"));
    assert.deepEqual(references.sort(), ["../b.ts", "./a", "src/c.ts", "src/d.scss", "src/e.ts"]);
});

test("changed sources select tests that reach them through other sources", t => {
    const {root, write} = fixture(t);
    // leaf 被中间模块引用，测试只引用中间模块：改动 leaf 必须能顺着依赖链找到该测试。
    const leaf = write("src/leaf.ts", "export const leaf = 1;");
    const middle = write("src/middle.ts", 'import {leaf} from "./leaf";\nexport const middle = leaf;');
    const direct = write("src/direct.test.ts", 'import {leaf} from "./leaf";');
    const indirect = write("src/indirect.test.ts", 'import {middle} from "./middle";');
    const stringLoader = write("tests/stringLoader.test.js",
        'const {middle} = load("src/middle.ts");');
    const unrelated = write("src/unrelated.test.ts", 'import {other} from "./other";');
    write("src/other.ts", "export const other = 2;");
    const all = [leaf, middle, direct, indirect, stringLoader, unrelated];

    assert.deepEqual(selectTests([leaf], all, root), [direct, indirect, stringLoader].sort());
    // 改动测试文件本身时只选它自己。
    assert.deepEqual(selectTests([unrelated], all, root), [unrelated]);
    // 改动没有被引用的源文件时不选任何测试。
    assert.deepEqual(selectTests([write("src/isolated.ts", "export {};")], all, root), []);
});

test("an undetectable dependency reports no tests instead of guessing", t => {
    const {root, write} = fixture(t);
    const source = write("src/source.ts", "export const value = 1;");
    const testFile = write("src/source.test.ts", "// 只由运行期字符串拼接决定加载目标\nconst name = \"source\";");
    assert.deepEqual(selectTests([source], [source, testFile], root), []);
});
