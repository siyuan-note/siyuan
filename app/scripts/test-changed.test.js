const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {test} = require("node:test");
const {execFileSync} = require("node:child_process");
const {selectTests, scanReferences, scanReferenceDetails, changedFiles, parseArguments} = require("./test-changed.mjs");

const fixture = t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-test-changed-")));
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

test("only whole type declarations omit runtime edges and duplicate source reads remain", () => {
    assert.deepEqual(scanReferenceDetails([
        'import type {A} from "./a.ts";',
        'export type {A} from "./a.ts";',
        'import {type A} from "./a.ts";',
        'import "./side";',
        'import("./dynamic");',
        'require("./required");',
        'readFileSync("./a.ts");',
    ].join("\n")), [
        {reference: "./a.ts", kind: "type"},
        {reference: "./a.ts", kind: "type"},
        {reference: "./a.ts", kind: "runtime"},
        {reference: "./side", kind: "runtime"},
        {reference: "./dynamic", kind: "runtime"},
        {reference: "./required", kind: "runtime"},
        {reference: "./a.ts", kind: "source"},
    ]);
});

test("parse failures preserve the conservative reference scan", () => {
    assert.deepEqual(scanReferenceDetails('import type {A} from "./a.ts"; const ='),
        [{reference: "./a.ts", kind: "unknown"}]);
});

test("embedded source, template paths and comments retain conservative dependencies", () => {
    const code = 'const snippet = `import {value} from "./module";`; // readFileSync("src/raw.ts")';
    assert.deepEqual(scanReferenceDetails(code), [
        {reference: "./module", kind: "source"},
        {reference: "src/raw.ts", kind: "source"},
    ]);
});

test("type-only paths require typecheck while source observers retain type dependencies", t => {
    const {root, write} = fixture(t);
    const leaf = write("src/leaf.ts", "export interface A {};");
    const middle = write("src/middle.ts", 'import type {A} from "./leaf.ts"; export const value = 1;');
    const runtime = write("src/runtime.test.ts", 'import {value} from "./middle";');
    const source = write("src/source.test.ts", 'readFileSync("./middle.ts");');
    const unknown = write("src/unknown.test.ts", 'readFileSync("./middle.ts"); const =');
    const details = {};
    const reasons = new Map();
    assert.deepEqual(selectTests([leaf], [leaf, middle, runtime, source, unknown], root, reasons, details), [source, unknown].sort());
    assert.equal(details.typecheck, true);
    assert.deepEqual(details.paths.get(source), ["type", "source"]);
    assert.deepEqual(reasons.get(source), [leaf, middle, source]);
    assert.deepEqual(selectTests([middle], [leaf, middle, runtime, source], root), [runtime, source].sort());
});

test("runtime duplicates, named type bindings, cycles and deleted type sources stay safe", t => {
    const {root, write} = fixture(t);
    const leaf = write("src/leaf.ts", 'import {value} from "./middle";');
    const middle = write("src/middle.ts", 'import type {A} from "./leaf.ts"; require("./leaf.ts");');
    const runtime = write("src/runtime.test.ts", 'import {value} from "./middle";');
    const named = write("src/named.test.ts", 'import {type A} from "./leaf.ts";');
    const typed = write("src/typed.test.ts", 'import type {A} from "./leaf.ts";');
    fs.unlinkSync(leaf);
    const details = {};
    assert.deepEqual(selectTests([leaf], [middle, runtime, named, typed], root, new Map(), details), [runtime, named].sort());
    assert.equal(details.typecheck, true);
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
    const reasons = new Map();
    assert.deepEqual(selectTests([leaf], all, root, reasons), [direct, indirect, stringLoader].sort());
    assert.deepEqual(reasons.get(indirect), [leaf, middle, indirect]);
    assert.deepEqual(reasons.get(stringLoader), [leaf, middle, stringLoader]);
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

test("relative and sibling source literals select their loading tests", t => {
    const {root, write} = fixture(t);
    const source = write("src/source.ts", "export const value = 1;");
    const parentLoader = write("src/nested/parent.test.ts",
        'readFileSync(path.join(__dirname, "../source.ts"), "utf8");');
    const siblingLoader = write("src/sibling.test.ts",
        'readFileSync(path.join(__dirname, "source.ts"), "utf8");');
    assert.deepEqual(selectTests([source], [source, parentLoader, siblingLoader], root),
        [parentLoader, siblingLoader].sort());
});

test("deleted sources still select importers without trying to run deleted tests", t => {
    const {root, write} = fixture(t);
    const removed = write("src/source.ts", "export const value = 1;");
    const imported = write("src/imported.test.ts", 'import {value} from "./source";');
    const loaded = write("src/loaded.test.ts", 'load("src/source.ts");');
    const deletedTest = write("src/deleted.test.ts", "");
    fs.unlinkSync(removed);
    fs.unlinkSync(deletedTest);
    assert.deepEqual(selectTests([removed, deletedTest], [imported, loaded], root), [imported, loaded].sort());
});

test("git paths preserve Unicode, whitespace and deleted entries", t => {
    const {root, write} = fixture(t);
    const run = (...args) => execFileSync("git", args, {cwd: root});
    const source = write("src/路径 with spaces.ts", "export const value = 1;");
    run("init", "--quiet");
    run("add", ".");
    const tree = run("write-tree").toString("utf8").trim();
    fs.unlinkSync(source);
    const added = write("src/新增.ts", "export {};");
    assert.deepEqual(changedFiles(tree, root).sort(), [source, added].sort());
});

test("renames keep the old path so stale importers are selected", t => {
    const {root, write} = fixture(t);
    const run = (...args) => execFileSync("git", args, {cwd: root});
    const source = write("src/source.ts", "export const value = 1;");
    const importer = write("src/source.test.ts", 'import {value} from "./source";');
    run("init", "--quiet");
    run("add", ".");
    const tree = run("write-tree").toString("utf8").trim();
    run("mv", "src/source.ts", "src/moved.ts");
    const touched = changedFiles(tree, root);
    assert.ok(touched.includes(source));
    assert.deepEqual(selectTests(touched, [importer, path.join(root, "src/moved.ts")], root), [importer]);
});

test("dependency and transpiler configuration changes select the whole suite", t => {
    const {root, write} = fixture(t);
    const first = write("src/first.test.ts", "");
    const second = write("tests/second.test.js", "");
    const source = write("src/unrelated.ts", "export {};");
    for (const name of ["package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.typecheck.json"]) {
        const reasons = new Map();
        assert.deepEqual(selectTests([path.join(root, name)], [first, second, source], root, reasons), [first, second].sort());
        assert.match(reasons.get(first), /full selection/);
    }
});

test("affected arguments reject misspellings and missing baselines", () => {
    assert.deepEqual(parseArguments(["--base", "origin/dev", "--explain", "--run"]),
        {base: "origin/dev", explain: true, run: true});
    for (const args of [["--base"], ["--base", "--run"], ["--explan"]]) {
        assert.throws(() => parseArguments(args));
    }
});

test("affected CLI distinguishes no changes from an unmapped change without claiming coverage", t => {
    const {root, write} = fixture(t);
    const script = write("app/scripts/test-changed.mjs", fs.readFileSync(path.join(__dirname, "test-changed.mjs"), "utf8")
        .replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(require.resolve("typescript")).href)}`));
    const run = (...args) => execFileSync("git", args, {cwd: root});
    run("init", "--quiet");
    run("add", ".");
    const tree = run("write-tree").toString("utf8").trim();
    const {spawnSync} = require("node:child_process");
    const invoke = () => spawnSync(process.execPath, [script, "--base", tree, "--run"], {encoding: "utf8"});
    const unchanged = invoke();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stderr, /没有改动/);
    write("app/src/isolated.ts", "export {};");
    const unmapped = invoke();
    assert.equal(unmapped.status, 0, unmapped.stderr);
    assert.equal(unmapped.stdout, "");
    assert.match(unmapped.stderr, /未找到关联测试/);
    assert.doesNotMatch(unmapped.stderr, /改动没有影响任何测试/);
    write("app/src/isolated.test.js", 'readFileSync("src/isolated.ts", "utf8");');
    const preview = spawnSync(process.execPath, [script, "--base", tree, "--explain"], {encoding: "utf8"});
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.stdout.trim(), "src/isolated.test.js");
    assert.match(preview.stderr, /选中 1 个测试文件/);
    assert.match(preview.stderr, /isolated\.test\.js:/);
});

test("affected CLI runs typecheck even without runtime tests and propagates failure", t => {
    const {root, write} = fixture(t);
    const script = write("app/scripts/test-changed.mjs", fs.readFileSync(path.join(__dirname, "test-changed.mjs"), "utf8")
        .replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(require.resolve("typescript")).href)}`));
    write("app/package.json", JSON.stringify({scripts: {typecheck: "node check.cjs"}}));
    write("app/.npmrc", "verify-deps-before-run=false\n");
    write("app/check.cjs", 'require("node:fs").writeFileSync("checked", "yes"); process.exit(7);');
    write("app/src/leaf.ts", "export interface A {}");
    write("app/src/typed.test.ts", 'import type {A} from "./leaf.ts";');
    const git = (...args) => execFileSync("git", args, {cwd: root});
    git("init", "--quiet");
    git("add", ".");
    const tree = git("write-tree").toString("utf8").trim();
    write("app/src/leaf.ts", "export interface A { value: string }");
    const invoke = () => require("node:child_process").spawnSync(process.execPath,
        [script, "--base", tree, "--run"], {encoding: "utf8"});
    const failed = invoke();
    assert.notEqual(failed.status, 0);
    assert.ok(fs.existsSync(path.join(root, "app/checked")), failed.stderr + failed.stdout);
    assert.equal(fs.readFileSync(path.join(root, "app/checked"), "utf8"), "yes");
    assert.doesNotMatch(failed.stderr, /Cannot find module.*electron/);
    const runtime = write("app/src/runtime.test.js", 'require("node:fs").writeFileSync("ran", "yes");');
    const blocked = invoke();
    assert.notEqual(blocked.status, 0);
    assert.doesNotMatch(blocked.stderr, /Cannot find module.*electron/);
    assert.equal(fs.existsSync(path.join(root, "app/ran")), false);
    fs.unlinkSync(runtime);
    write("app/check.cjs", 'require("node:fs").writeFileSync("checked", "passed");');
    const passed = invoke();
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(fs.readFileSync(path.join(root, "app/checked"), "utf8"), "passed");
});
