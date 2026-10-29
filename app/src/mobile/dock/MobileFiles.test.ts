import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {MobileOpenedFileSelection} from "./mobileOpenedFileSelection";
import type {DocTreeController} from "../../layout/dock/docTree/DocTreeController";
import type {IMenuSession} from "../../menus/menuToggle";

const loadMethods = (names: string[], globals: Record<string, unknown>) => {
    const source = createSourceFile("MobileFiles.ts", readFileSync("src/mobile/dock/MobileFiles.ts", "utf8"), ScriptTarget.Latest, true);
    const methods = source.statements.find(isClassDeclaration).members.filter(member =>
        names.includes(member.name?.getText(source))).map(member => member.getText(source));
    const exports: {Adapter?: new () => object} = {};
    runInNewContext(transpileModule(`class Adapter {${methods.join("\n")}} exports.Adapter = Adapter;`, {
        compilerOptions: {target: ScriptTarget.ES2022},
    }).outputText, {...globals, exports});
    return new exports.Adapter();
};

test("mobile opened-file tracking keeps an offscreen selection without querying a row", async () => {
    const adapter = loadMethods(["selectOpenedFile"], {}) as {
        docTree: {getSelectedItems: () => {notebookId: string, path: string}[]};
        openedFileSelection: MobileOpenedFileSelection;
        element: {querySelector: () => never};
        selectItem: () => never;
        selectOpenedFile: (notebook: string, path: string) => Promise<void>;
    };
    adapter.docTree = {getSelectedItems: () => [{notebookId: "box", path: "/far.sy"}]};
    adapter.openedFileSelection = new MobileOpenedFileSelection();
    adapter.element = {querySelector: () => { throw new Error("The selected row is not mounted"); }};
    adapter.selectItem = () => { throw new Error("The logical selection is already current"); };
    await adapter.selectOpenedFile("box", "/far.sy");
});

test("mobile drag targets follow recycled rows while the pointer stays at the edge", () => {
    const row = (key: string) => {
        const classes = new Set<string>();
        return {key, classes, closest() { return this; },
            classList: {add: (value: string) => classes.add(value)},
            getBoundingClientRect: () => ({top: 0, bottom: 40, height: 40})};
    };
    const source = row("source");
    const first = row("first");
    const second = row("second");
    let hit = first;
    const adapter = loadMethods(["updateTouchDrop"], {document: {elementFromPoint: () => hit}}) as {
        docTree: {getItemFromElement: (element: ReturnType<typeof row>) => {kind: string, occurrenceKey: string}};
        pinnedDocs: {element: {contains: () => boolean}, clearDrop: () => void};
        getTouchDragSource: () => {kind: string, occurrenceKey: string};
        clearDragIndicators: () => void;
        updateTouchDrop: (state: object) => void;
    };
    adapter.docTree = {getItemFromElement: element => element && ({kind: "document", occurrenceKey: element.key})};
    adapter.getTouchDragSource = () => ({kind: "document", occurrenceKey: source.key});
    adapter.pinnedDocs = {element: {contains: () => false}, clearDrop() {}};
    adapter.clearDragIndicators = () => [source, first, second].forEach(element => element.classes.clear());
    const state = {selectedElement: source, pointerX: 12, pointerY: 39};
    adapter.updateTouchDrop(state);
    assert.ok(first.classes.has("dragover__bottom"));
    hit = second;
    adapter.updateTouchDrop(state);
    assert.equal(first.classes.size, 0);
    assert.ok(second.classes.has("dragover__bottom"));
    hit = source;
    adapter.updateTouchDrop(state);
    assert.equal(source.classes.size + first.classes.size + second.classes.size, 0);
});

test("mobile multi-selection menus mount one anchor and reject a changed selection", async () => {
    for (const valid of [true, false]) {
        const selected = Array.from({length: 10000}, (_, index) => ({
            occurrenceKey: `box/${index}`, id: `${index}`, notebookId: "box", path: `/${index}.sy`, kind: "document",
        }));
        const calls: string[] = [];
        const adapter = loadMethods(["showMultiSelectMenu"], {
            initFileMenu: () => calls.push("menu"),
            window: {siyuan: {menus: {menu: {fullscreen: () => calls.push("show")}}}},
        }) as {docTree: Partial<DocTreeController>, showMultiSelectMenu: (session: IMenuSession) => Promise<void>};
        adapter.docTree = {
            getSelectedItems: () => selected as ReturnType<DocTreeController["getSelectedItems"]>,
            selectionVersion: 1,
            ensureRendered: async key => { assert.equal(key, "box/0"); calls.push("mount"); return {} as HTMLElement; },
            validateSelection: () => valid,
            getSelectionElements: () => { throw new Error("The toolbar must not build a complete DOM snapshot"); },
        };
        await adapter.showMultiSelectMenu({isCurrent: () => true, show: callback => callback()});
        assert.deepEqual(calls, valid ? ["mount", "menu", "show"] : ["mount"]);
    }
});

test("mobile drag sources are frozen and invalidated by selection or document changes", () => {
    const source = {id: "source", notebookId: "box", path: "/source.sy", occurrenceKey: "box/source"};
    let current: typeof source = {...source};
    const adapter = loadMethods(["getTouchDragSource"], {}) as {
        docTree: {selectionVersion: number, getItem: (key: string) => typeof source};
        getTouchDragSource: (state: {source: typeof source, selectionVersion: number}) => typeof source;
    };
    adapter.docTree = {selectionVersion: 4, getItem: () => current};
    const state = {source, selectionVersion: 4};
    assert.equal(adapter.getTouchDragSource(state), source);
    adapter.docTree.selectionVersion++;
    assert.equal(adapter.getTouchDragSource(state), undefined);
    adapter.docTree.selectionVersion = 4;
    current = {...source, path: "/moved/source.sy"};
    assert.equal(adapter.getTouchDragSource(state), undefined);
    current = undefined;
    assert.equal(adapter.getTouchDragSource(state), undefined);
});

test("mobile canceled locates leave a newer viewport and saved state alone", async () => {
    const adapter = loadMethods(["selectItem"], {}) as {
        docTree: Partial<DocTreeController>;
        getOpenPaths: () => void;
        selectItem: (box: string, path: string, data?: IFileTreeList, save?: boolean, select?: boolean) => Promise<HTMLElement>;
    };
    let interaction = 1;
    let complete: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    adapter.docTree = {
        get interactionVersion() { return interaction; },
        locate: async () => { await pending; return undefined; },
        findItem: () => ({occurrenceKey: "cached"}) as ReturnType<DocTreeController["findItem"]>,
        ensureRendered: async () => { throw new Error("Canceled navigation must not scroll"); },
    };
    adapter.getOpenPaths = () => { throw new Error("Canceled navigation must not save"); };
    const result = adapter.selectItem("box", "/old.sy", undefined, true, false);
    interaction++;
    complete();
    assert.equal(await result, undefined);
});
