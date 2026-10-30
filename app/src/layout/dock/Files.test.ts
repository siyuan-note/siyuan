import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import type {DocTreeController} from "./docTree/DocTreeController";
import {DocTreeModel} from "./docTree/DocTreeModel";

const source = createSourceFile("Files.ts", readFileSync("src/layout/dock/Files.ts", "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.find(isClassDeclaration);
const methods = declaration.members.filter(member =>
    ["selectItem", "getLeaf", "setCurrent", "toggleLeaf"].includes(member.name?.getText(source))).map(member => member.getText(source));
const compiled = transpileModule(`class Adapter {${methods.join("\n")}} exports.Adapter = Adapter;`, {
    compilerOptions: {target: ScriptTarget.ES2022},
}).outputText;

interface IAdapter {
    docTree: Partial<DocTreeController>;
    parentDocClick: {cancel: () => void};
    getOpenPaths: () => void;
    selectItem: (box: string, path: string, data?: IFileTreeList, save?: boolean, select?: boolean) => Promise<HTMLElement>;
    getLeaf: (row: Element, notebook: string, refresh?: boolean) => void;
    setCurrent: (row: HTMLElement, scroll?: boolean) => void;
    toggleLeaf: (row: Element, notebook: string) => Promise<void>;
}

const createAdapter = (globals: Record<string, unknown> = {}) => {
    const exports: {Adapter?: new () => IAdapter} = {};
    runInNewContext(compiled, {...globals, exports});
    return new exports.Adapter();
};

test("public tree selection mounts a far document even when selection is unchanged", async () => {
    const adapter = createAdapter();
    const calls: unknown[] = [];
    const item = {occurrenceKey: "notebook:box/parent/target"};
    const row = {id: "mounted"} as HTMLElement;
    let release: () => void;
    const located = new Promise<void>(resolve => { release = resolve; });
    adapter.docTree = {
        locate: async (box, id, options) => { calls.push(["locate", box, id, options]); await located; return undefined; },
        findItem: () => item as ReturnType<DocTreeController["findItem"]>,
        ensureRendered: async key => { calls.push(["mount", key]); return row; },
    };
    adapter.getOpenPaths = () => calls.push("save");
    const selected = adapter.selectItem("box", "/parent/target.sy", undefined, true, false);
    assert.equal(calls.length, 1);
    release();
    assert.equal(await selected, row);
    assert.equal(JSON.stringify(calls), JSON.stringify([
        ["locate", "box", "target", {select: false, scroll: false}], "save", ["mount", item.occurrenceKey],
    ]));
});

test("notebook arrows read the directory before deciding whether to create a document", async () => {
    for (const scenario of [
        {total: 2, revision: "one", readonly: false, canceled: false, expected: 0},
        {total: 0, revision: "one", readonly: false, canceled: false, expected: 1},
        {total: 0, revision: undefined, readonly: false, canceled: false, expected: 0},
        {total: 0, revision: "one", readonly: true, canceled: false, expected: 0},
        {total: 0, revision: "one", readonly: false, canceled: true, expected: 0},
    ]) {
        let created = 0;
        let expanded = false;
        let interaction = 0;
        let release: () => void;
        const ready = new Promise<void>(resolve => { release = resolve; });
        const adapter = createAdapter({window: {siyuan: {config: {readonly: scenario.readonly}}},
            newFileInTree: () => { created++; }});
        const model = new DocTreeModel();
        model.setRoots([{id: "box", notebookId: "box", kind: "notebook", path: "/", name: "Box", subFileCount: 0}]);
        const directory = model.directory(model.roots[0]);
        directory.total = scenario.total;
        directory.revision = scenario.revision;
        adapter.parentDocClick = {cancel: () => {}};
        adapter.docTree = {
            get interactionVersion() { return interaction; },
            getItemFromElement: () => model.roots[0],
            toggle: async () => { interaction++; await ready; expanded = !expanded; },
            isExpanded: () => expanded,
            model,
        };
        const opening = adapter.toggleLeaf({} as Element, "box");
        assert.equal(created, 0, "a missing notebook summary count cannot trigger creation before the range loads");
        if (scenario.canceled) { interaction++; }
        release();
        await opening;
        assert.equal(created, scenario.expected, JSON.stringify(scenario));
        if (scenario.total > 0) {
            await adapter.toggleLeaf({} as Element, "box");
            assert.equal(expanded, false, "clicking the loaded notebook folds it");
            assert.equal(created, 0, "repeated notebook clicks never create extra documents");
        }
    }
});

test("missing or locked targets never return an old DOM row", async () => {
    const adapter = createAdapter();
    adapter.docTree = {locate: async () => undefined, findItem: () => undefined,
        ensureRendered: async () => { throw new Error("Unavailable targets must not mount"); }};
    adapter.getOpenPaths = () => { throw new Error("Storage was disabled"); };
    assert.equal(await adapter.selectItem("box", "/deleted.sy", undefined, false), undefined);
});

test("a canceled public locate never scrolls back to its cached old target", async () => {
    for (const select of [true, false]) {
        const adapter = createAdapter();
        let interaction = 1;
        let complete: () => void;
        const pending = new Promise<void>(resolve => { complete = resolve; });
        adapter.docTree = {
            get interactionVersion() { return interaction; },
            locate: async () => { await pending; return undefined; },
            findItem: () => ({occurrenceKey: "cached"}) as ReturnType<DocTreeController["findItem"]>,
            ensureRendered: async () => { throw new Error("Canceled navigation must not restore its old viewport"); },
        };
        adapter.getOpenPaths = () => { throw new Error("Canceled navigation must not save its old state"); };
        const result = adapter.selectItem("box", "/old.sy", undefined, true, select);
        interaction++;
        complete();
        assert.equal(await result, undefined);
    }
});

test("refreshing a directory uses document identity instead of a sibling UL", () => {
    const adapter = createAdapter();
    const calls: unknown[] = [];
    const row = {} as HTMLElement;
    adapter.parentDocClick = {cancel: () => calls.push("cancel")};
    adapter.docTree = {
        getItemFromElement: () => ({id: "parent", kind: "document", occurrenceKey: "key"}) as ReturnType<DocTreeController["getItemFromElement"]>,
        reload: async filter => { calls.push(filter); },
        toggle: async key => { calls.push(["toggle", key]); },
        select: async (key, options) => { calls.push(["select", key, options]); },
    };
    adapter.getLeaf(row, "box", true);
    adapter.getLeaf(row, "box");
    adapter.setCurrent(row, false);
    assert.equal(JSON.stringify(calls), JSON.stringify([
        "cancel", {notebook: "box", parentID: "parent"}, "cancel", ["toggle", "key"], ["select", "key", {scroll: false}],
    ]));
});
