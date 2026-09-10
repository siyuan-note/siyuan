import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getZoomFocusScrollAttr, shouldFocusAfterZoom} from "../protyle/util/focusRestore";

const source = createSourceFile("protyle.ts", readFileSync("src/menus/protyle.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "zoomOut"));
const compiled = transpileModule(declaration.getText(source), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (tablet: boolean, alreadyZoomed = false, missingTarget = false) => {
    const loads: any[] = [];
    const pending: Promise<void>[] = [];
    let focused = 0;
    let scrolled = 0;
    const target = {
        getBoundingClientRect: () => ({height: 20}),
        classList: {contains: () => false},
        scrollIntoView: () => scrolled++,
    };
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        isPhablet: () => tablet,
        hasClosestByClassName: (): undefined => undefined,
        isEncryptedBox: () => false,
        Constants: {
            CB_GET_HTML: "html", CB_GET_ALL: "all", CB_GET_FOCUS: "focus", CB_GET_UNUNDO: "unundo",
        },
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 64, backlinkShowBottom: true}}}},
        fetchPost: (_url: string, _data: any, callback: (data: any) => Promise<void>) => {
            pending.push(Promise.resolve(callback({data: {}})));
        },
        fetchSyncPost: async () => ({data: {parentID: "target"}}),
        onGet: (options: any) => loads.push(options),
        focusBlock: () => focused++,
        focusByOffset: () => focused++,
        scrollCenter: () => scrolled++,
        getFirstBlock: (element: any) => element,
        getZoomFocusScrollAttr,
        shouldFocusAfterZoom,
    });
    const protyle = {
        options: {},
        block: {rootID: "root"},
        breadcrumb: alreadyZoomed ? {element: {
            parentElement: {querySelector: (): undefined => undefined},
            querySelector: () => ({getAttribute: () => "target"}),
        }} : undefined,
        wysiwyg: {element: {querySelector: () => missingTarget ? undefined : target}},
    };
    return {
        loads,
        focused: () => focused,
        scrolled: () => scrolled,
        settle: () => Promise.all(pending),
        zoom: (options: any = {}) => exports.zoomOut({protyle, id: "target", ...options}),
    };
};

test("tablet block navigation suppresses focus during document loading", () => {
    const f = fixture(true);
    f.zoom();
    assert.equal(f.loads.length, 1);
    assert.equal(f.loads[0].suppressFocus, true);
    assert.equal(f.loads[0].action.includes("focus"), true);
    assert.equal(f.focused(), 0);
});

test("clicking the current breadcrumb scrolls without focusing on tablets", () => {
    const f = fixture(true, true);
    f.zoom();
    assert.equal(f.loads.length, 0);
    assert.equal(f.scrolled(), 1);
    assert.equal(f.focused(), 0);
});

test("tablet exit-focus navigation scrolls to its saved target without restoring a selection", () => {
    const f = fixture(true);
    f.zoom({id: "root", focusId: "target", focusPosition: {start: 2, end: 5}, suppressFocus: true});
    assert.equal(f.loads[0].suppressFocus, true);
    assert.equal(f.scrolled(), 1);
    assert.equal(f.focused(), 0);
});

test("a dynamically loaded exit-focus target retains focus suppression", async () => {
    const f = fixture(true, false, true);
    f.zoom({id: "root", focusId: "target", suppressFocus: true});
    await f.settle();
    assert.equal(f.loads.length, 2);
    assert.ok(f.loads.every(load => load.suppressFocus));
    assert.equal(f.loads[1].scrollAttr.focusId, "target");
    assert.equal(f.focused(), 0);
});

test("tablet editing recovery still restores explicit cursor offsets", () => {
    const f = fixture(true);
    f.zoom({id: "root", focusId: "target", focusPosition: {start: 2, end: 5}, isPushBack: false});
    assert.equal(f.loads[0].suppressFocus, false);
    assert.equal(f.focused(), 1);
});

test("desktop breadcrumb navigation retains focus", () => {
    const f = fixture(false, true);
    f.zoom();
    assert.equal(f.focused(), 1);
    assert.equal(f.scrolled(), 1);
});
