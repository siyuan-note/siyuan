import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const storageKey = "local-tabs-reading";
const compile = (source: string) => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const readingSource = compile(readFileSync("src/protyle/wysiwyg/tabsReading.ts", "utf8"));
const renderer = ts.createSourceFile("tabsRender.ts", readFileSync("src/protyle/render/tabsRender.ts", "utf8"),
    ts.ScriptTarget.ES2021, true);
let selectSource: string;
let restoreSource: string;
const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(renderer) === "select") {
        selectSource = node.body.getText(renderer);
    }
    if (ts.isIfStatement(node) && node.expression.getText(renderer) === "!state || state.owner !== controller") {
        restoreSource = node.thenStatement.getText(renderer);
    }
    node.forEachChild(visit);
};
visit(renderer);
assert.ok(selectSource);
assert.ok(restoreSource);

const fixture = (storage: Record<string, any> = {}) => {
    const writes: Record<string, string>[] = [];
    const siyuan = {storage, config: {readonly: false}, isPublish: false};
    const api = {} as typeof import("./tabsReading");
    const root = {};
    const protyle = {disabled: true, lite: false, notebookId: "ordinary", options: {action: [] as string[]},
        wysiwyg: {element: root}};
    let excluded = false;
    let inside = true;
    const block = (id = "tabs") => ({dataset: {nodeId: id}, getAttribute: () => "a",
        closest: (selector: string) => selector === ".protyle-wysiwyg" ? (inside ? root : null) : excluded ? root : null});
    const read = (tabs = block()) => api.getTabReadingID(protyle as IProtyle, tabs as unknown as HTMLElement);
    const save = (id: string, tabs = block()) => api.saveTabReadingID(protyle as IProtyle, tabs as unknown as HTMLElement, id);
    runInNewContext(readingSource, {exports: api, window: {siyuan}, require: (id: string) => {
        if (id === "../../constants") {
            return {Constants: {LOCAL_TABS_READING: storageKey, CB_GET_HISTORY: "history"}};
        }
        if (id === "../../util/pathName") {
            return {isEncryptedBox: (notebook: string) => notebook === "encrypted"};
        }
        assert.equal(id, "../util/compatibility");
        return {setStorageVal: (key: string, selections: Record<string, string>) => {
            assert.equal(key, storageKey);
            writes.push(JSON.parse(JSON.stringify(selections)));
        }};
    }});
    return {siyuan, protyle, writes, block, read, save,
        exclude: () => { excluded = true; }, outside: () => { inside = false; }};
};

test("readonly selection survives reopening and restart without changing document attributes", () => {
    const f = fixture();
    const tabs = f.block();
    f.save("b", tabs);
    assert.equal(tabs.getAttribute(), "a");
    assert.equal(f.read(f.block()), "b");
    assert.equal(f.writes.length, 1);
    const restarted = fixture({[storageKey]: f.writes[0]});
    assert.equal(restarted.read(), "b");
    assert.equal(restarted.read(restarted.block("other")), undefined);
    assert.equal(fixture().read(), undefined);
    f.save("b");
    assert.equal(f.writes.length, 1);
});

test("editing uses document defaults and clears an old readonly selection", () => {
    const f = fixture();
    f.save("b");
    f.protyle.disabled = false;
    assert.equal(f.read(), undefined);
    f.save("a");
    assert.deepEqual(f.writes[1], {});
    f.protyle.disabled = true;
    assert.equal(f.read(), undefined);
});

test("publish, global readonly and encrypted notebooks retain only session selections", () => {
    for (const mode of ["publish", "readonly", "encrypted"]) {
        const f = fixture({[storageKey]: {other: "unchanged"}});
        f.siyuan.isPublish = mode === "publish";
        f.siyuan.config.readonly = mode === "readonly";
        f.protyle.notebookId = mode === "encrypted" ? "encrypted" : "ordinary";
        f.save("b");
        assert.equal(f.read(f.block()), "b");
        assert.equal(f.writes.length, 0);
        assert.deepEqual(f.siyuan.storage[storageKey], {other: "unchanged"});
        f.siyuan.storage = {};
        assert.equal(f.read(), undefined, "a different workspace cannot inherit session selections");
    }
});

test("history, lite editors, embedded previews and foreign roots do not restore or save reading positions", () => {
    for (const mode of ["history", "lite", "preview", "foreign"]) {
        const f = fixture({[storageKey]: {tabs: "b"}});
        if (mode === "history") { f.protyle.options.action.push("history"); }
        if (mode === "lite") { f.protyle.lite = true; }
        if (mode === "preview") { f.exclude(); }
        if (mode === "foreign") { f.outside(); }
        assert.equal(f.read(), undefined);
        f.save("a");
        assert.equal(f.writes.length, 0);
        assert.equal(f.siyuan.storage[storageKey].tabs, "b");
    }
});

test("reading records tolerate malformed storage and keep the most recent thousand blocks", () => {
    for (const value of [null, "invalid", [], {tabs: 42}] as unknown[]) {
        const f = fixture({[storageKey]: value});
        assert.equal(f.read(), undefined);
        f.save("b");
        assert.equal(f.read(), "b");
    }
    const saved = Object.fromEntries(Array.from({length: 1000}, (_, index) => [`tabs-${index}`, "a"]));
    const f = fixture({[storageKey]: saved});
    f.save("b", f.block("tabs-0"));
    f.save("b");
    assert.equal(Object.keys(f.siyuan.storage[storageKey]).length, 1000);
    assert.equal(f.siyuan.storage[storageKey]["tabs-1"], undefined);
    assert.equal(f.siyuan.storage[storageKey]["tabs-0"], "b");
});

test("renderer remembers readonly navigation, guards document writes and leaves temporary reveals unsaved", () => {
    const f = fixture();
    const tabs = f.block();
    const states = new WeakMap();
    let documentWrites = 0;
    const controller = {render() {}, options: {
        readonly: () => f.protyle.disabled, remember: (_tabs: unknown, id: string) => f.save(id),
        select: () => documentWrites++,
    }};
    const state = {owner: controller, active: "a", pending: undefined as string | undefined};
    states.set(tabs, state);
    const select = (id: string, persist = true) => runInNewContext(compile(`(() => ${selectSource})();`), {
        tabs, id, persist, states, controller, itemID: (item: {id: string}) => item.id,
        getTabItems: () => [{id: "a", dataset: {}}, {id: "b", dataset: {}}],
    });
    select("b");
    assert.equal(state.active, "b");
    assert.equal(f.read(), "b");
    assert.equal(documentWrites, 0);
    select("a", false);
    assert.equal(state.active, "a");
    assert.equal(f.read(), "b");
    select("missing");
    assert.equal(state.active, "a");
    f.protyle.disabled = false;
    select("a");
    assert.equal(documentWrites, 1);
    assert.deepEqual(f.writes.at(-1), {});
});

test("renderer restores valid reading positions and falls back to document defaults after deletion", () => {
    for (const restored of ["b", "missing", undefined]) {
        const context = {states: new WeakMap(), tabs: {}, controller: {options: {restore: () => restored}},
            ids: ["a", "b", "c"], source: "c", instanceID: 0, state: undefined as {active: string, source: string}};
        runInNewContext(compile(restoreSource), context);
        assert.equal(context.state.active, restored === "b" ? "b" : "c");
        assert.equal(context.state.source, "c");
    }
});
