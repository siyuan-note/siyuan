import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isPropertyAssignment, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapFoldStates, getListMindmapSiblingFoldStates} from "./fold";
import type {ListMindmapFoldTarget} from "./fold";
import type {ListMindmapNode} from "./model";
const {loadMenuToggle} = require("../../../../tests/menu-toggle-fixture.cjs");

const node = (id: string, children: ListMindmapNode[] = [], collapsed = false): ListMindmapNode => ({
    id, children, collapsed, virtual: false, contentBlocks: [],
});

test("sibling folding follows the list toggle rule within one parent and preserves deeper states", () => {
    const deep = node("deep", [node("leaf")], true);
    const a = {...node("a", [deep], true), parentId: "parent"};
    const b = {...node("b", [node("child")]), parentId: "parent"};
    const leaf = {...node("leafSibling"), parentId: "parent"};
    const other = {...node("other", [node("otherChild")]), parentId: "otherParent"};
    const parent = node("parent", [a, b, leaf]);
    const model = {nodes: new Map([parent, a, b, leaf, other, deep].map(item => [item.id, item]))};
    assert.deepEqual([...getListMindmapSiblingFoldStates(model, a.id)], [[a.id, true], [b.id, true]]);
    b.collapsed = true;
    assert.deepEqual([...getListMindmapSiblingFoldStates(model, a.id)], [[a.id, false], [b.id, false]]);
    assert.deepEqual([...getListMindmapSiblingFoldStates(model, a.id, new Map([[a.id, false]]))],
        [[a.id, true], [b.id, true]]);
    assert.equal(deep.collapsed, true);
    assert.equal(other.collapsed, false);
    assert.equal(leaf.collapsed, false);
    assert.equal(getListMindmapSiblingFoldStates(model, "missing").size, 0);
    assert.deepEqual([...getListMindmapSiblingFoldStates(model, parent.id)], [[parent.id, true]]);
    parent.virtual = true;
    assert.deepEqual([...getListMindmapSiblingFoldStates(model, parent.id)], [[parent.id, true]]);
    assert.equal(getListMindmapSiblingFoldStates({nodes: new Map([["leaf", node("leaf")]])}, "leaf").size, 0);
});

test("the selected level expands inclusively and either kind of center counts as level one", () => {
    for (const virtual of [false, true]) {
        const root = {...node("root", [node("a", [node("b", [node("leaf")])], true), node("c")]), virtual};
        assert.deepEqual([...getListMindmapFoldStates(root, "foldAll")], [["root", true]]);
        assert.deepEqual([...getListMindmapFoldStates(root, 1)], [["root", false], ["a", true]]);
        assert.deepEqual([...getListMindmapFoldStates(root, 2)], [["root", false], ["a", false], ["b", true]]);
        assert.deepEqual([...getListMindmapFoldStates(root, "expandAll")], [["root", false], ["a", false], ["b", false]]);
        assert.deepEqual(getListMindmapFoldStates(root, 3), getListMindmapFoldStates(root, "expandAll"));
        assert.equal(root.children[0].collapsed, true, "planning never mutates source folding states");
    }
    assert.equal(getListMindmapFoldStates(node("leaf"), 1).size, 0);
});

test("six-level expansion handles deep trees and invalid levels leave nodes untouched", () => {
    let root = node("leaf");
    for (let i = 0; i < 1000; i++) {
        root = node(String(i), [root]);
    }
    assert.equal(getListMindmapFoldStates(root, 6).size, 7);
    assert.equal(getListMindmapFoldStates(root, "expandAll").size, 1000);
    for (const level of [0, -1, .5, NaN, Infinity]) {
        assert.equal(getListMindmapFoldStates(root, level).size, 0);
    }
});

test("desktop and mobile menus offer six levels without icon placeholders followed by expand and collapse actions", () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    let callback = "";
    const visit = (item: import("typescript").Node) => {
        if (isPropertyAssignment(item) && item.name.getText(source) === "onExpandLevelMenu") {
            callback = item.initializer.getText(source);
        }
        item.forEachChild(visit);
    };
    visit(source);
    assert.ok(callback);
    for (const mobile of [false, true]) {
        const entries: {id: string, label?: string, iconHTML?: string, click?: () => void}[] = [];
        const positions: unknown[] = [];
        const selected: ListMindmapFoldTarget[] = [];
        const context = {
            Menu: class {
                addItem(item: typeof entries[number]) { entries.push(item); }
                addSeparator(item: typeof entries[number]) { entries.push(item); }
                fullscreen(position: string) { positions.push(position); }
                open(position: unknown) { positions.push(position); }
            },
            isMobile: () => mobile,
            window: {siyuan: {menus: {menu: {element: {classList: {contains: () => true}}, remove() {}}},
                languages: {listMindmapExpandToLevel: "Level ${level}", expandAll: "Expand", foldAll: "Collapse"}}},
        };
        Object.assign(context, loadMenuToggle(context));
        const open = runInNewContext(transpileModule(`(${callback})`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, context);
        open({closest: (): null => null, setAttribute() {}, getBoundingClientRect: () => ({left: 10, bottom: 30, height: 20})},
            (level: ListMindmapFoldTarget) => selected.push(level));
        assert.deepEqual(entries.map(item => item.id), [...Array.from({length: 6}, (_, i) => `level${i + 1}`),
            "separator_all", "expandAll", "foldAll"]);
        entries.slice(0, 6).forEach(item => assert.equal(item.iconHTML, ""));
        entries[5].click();
        entries[7].click();
        entries[8].click();
        assert.deepEqual(selected, [6, "expandAll", "foldAll"]);
        assert.deepEqual(JSON.parse(JSON.stringify(positions)), mobile ? ["bottom"] : [{x: 10, y: 30, h: 20}]);
    }
});

test("batch folding saves a single undo snapshot and reads the source after finishing edits", async () => {
    const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const controller = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapController");
    assert.ok(controller && isClassDeclaration(controller));
    let callback = "";
    let siblingCallback = "";
    const visit = (item: import("typescript").Node) => {
        if (isPropertyAssignment(item) && item.name.getText(source) === "onFoldLevel") {
            callback = item.initializer.getText(source);
        } else if (isPropertyAssignment(item) && item.name.getText(source) === "onFoldSiblings") {
            siblingCallback = item.initializer.getText(source);
        }
        item.forEachChild(visit);
    };
    visit(controller);
    assert.ok(callback);
    assert.ok(siblingCallback);
    const change = controller.members.find(item => item.name?.getText(source) === "change");
    assert.ok(change);
    const compiled = transpileModule(`class Controller {
        ${change.getText(source)}
        constructor(list) { this.list = list; this.onFoldLevel = ${callback}; this.onFoldSiblings = ${siblingCallback}; }
    }
    globalThis.Controller = Controller;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const root = node("root", [node("a", [node("b", [node("leaf")])]), node("c", [node("d")])]);
    const nodes = new Map<string, ListMindmapNode>();
    const collect = (current: ListMindmapNode) => {
        nodes.set(current.id, current);
        current.element = {setAttribute: (_name: string, value: string) => current.collapsed = value === "1"} as unknown as HTMLElement;
        current.children.forEach(child => {
            child.parentId = current.id;
            collect(child);
        });
    };
    collect(root);
    const snapshot = () => JSON.stringify([...nodes].map(([id, current]) => [id, current.collapsed]));
    const list = {isConnected: true, get outerHTML() { return snapshot(); }};
    const transactions: {before: string, after: string}[] = [];
    let allowed = true;
    const context: any = {
        canEdit: () => allowed,
        readListMindmap: () => ({root, nodes}),
        getListMindmapSiblingIDs: () => new Map(),
        normalizeListMindmapSummaryMetadata: () => {},
        getListMindmapFoldStates,
        getListMindmapSiblingFoldStates,
        cleanListMindmapHTML: (html: string) => html,
        updateTransaction: (_owner: unknown, _list: unknown, before: string) => {
            if (before !== snapshot()) {
                transactions.push({before, after: snapshot()});
            }
        },
        showMessage: () => assert.fail("Unexpected invalid source"), console,
        window: {siyuan: {languages: {}}},
    };
    runInNewContext(compiled, context);
    const target = new context.Controller(list);
    Object.assign(target, {owner: {}, view: {getSelectedId: () => root.id}, refresh: () => {}});
    const before = snapshot();
    assert.equal(await target.onFoldLevel(1), true);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].before, before);
    assert.equal(nodes.get("a").collapsed, true);
    assert.equal(nodes.get("c").collapsed, true);
    assert.equal(nodes.get("b").collapsed, false, "hidden descendants retain their state");
    assert.equal(await target.onFoldLevel(1), true);
    assert.equal(transactions.length, 1);
    target.activeEditor = {finish: async () => false};
    assert.equal(await target.onFoldLevel("expandAll"), false);
    assert.equal(transactions.length, 1);
    target.activeEditor = {finish: async () => { nodes.get("b").collapsed = true; return true; }};
    assert.equal(await target.onFoldLevel("expandAll"), true);
    assert.equal(transactions.length, 2);
    assert.ok(JSON.parse(transactions[1].before).some(([id, collapsed]: [string, boolean]) => id === "b" && collapsed));
    assert.equal(transactions[1].after, before, "one redo snapshot contains the complete expanded state");
    target.activeEditor = undefined;
    nodes.get("a").collapsed = true;
    nodes.get("b").collapsed = true;
    const siblingBefore = snapshot();
    assert.equal(await target.onFoldSiblings("a"), true);
    assert.equal(transactions.length, 3);
    assert.equal(transactions[2].before, siblingBefore);
    assert.equal(nodes.get("c").collapsed, true, "a mixed sibling group folds together");
    assert.equal(nodes.get("root").collapsed, false);
    assert.equal(nodes.get("b").collapsed, true, "descendant state is retained");
    assert.equal(await target.onFoldSiblings("a"), true);
    assert.equal(transactions.length, 4);
    assert.equal(nodes.get("a").collapsed, false);
    assert.equal(nodes.get("c").collapsed, false);
    assert.equal(nodes.get("b").collapsed, true);
    target.activeEditor = {finish: async () => false};
    assert.equal(await target.onFoldSiblings("a"), false);
    assert.equal(transactions.length, 4);
    target.activeEditor = undefined;
    allowed = false;
    assert.equal(await target.onFoldLevel(1), false);
    assert.equal(await target.onFoldSiblings("a"), false);
    assert.equal(transactions.length, 4);
});
