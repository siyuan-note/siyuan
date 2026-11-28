import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
const compile = (text: string) => transpileModule(text, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

test("session outline opens one foreground source editor and refreshes on return without ending the session", () => {
    const start = source.indexOf("let outlineSourceOpen = false;");
    const end = source.indexOf("releaseOpening();", start);
    let navigate: (id: string) => void;
    let close: () => void;
    const opened: unknown[][] = [];
    let refreshes = 0;
    const context = {
        app: {}, dialog: {element: {isConnected: true, dataset: {dialogClosing: "false"}}},
        sessionFinished: false, requestPending: false, renderPending: false,
        mobile: false,
        bindWorkspaceReviewOutline: (_app: unknown, _surface: unknown, _mobile: boolean, callback: (id: string) => void) => { navigate = callback; },
        openFlashcardV2SourceEditor: (_app: unknown, id: string, callback: () => void, locate: boolean) => {
            opened.push([id, locate]); close = callback;
        },
        refreshCurrent: () => { refreshes++; },
    };
    runInNewContext(compile(source.slice(start, end)), context);
    navigate("heading"); navigate("heading");
    assert.deepEqual(opened, [["heading", true]]);
    close();
    assert.equal(refreshes, 1);
    navigate("second");
    assert.equal(opened.length, 2);
    close();
    for (const key of ["sessionFinished", "requestPending", "renderPending"] as const) {
        context[key] = true;
        navigate("blocked");
        assert.equal(opened.length, 2);
        context[key] = false;
    }
    for (const closing of [false, true]) {
        navigate("returning");
        const before: number = refreshes;
        context.dialog.element.isConnected = closing;
        context.dialog.element.dataset.dialogClosing = String(closing);
        close();
        assert.equal(refreshes, before);
        const count: number = opened.length;
        navigate("closed");
        assert.equal(opened.length, count);
        context.dialog.element.isConnected = true;
        context.dialog.element.dataset.dialogClosing = "false";
    }
});

test("source editor enables heading scroll only for explicit outline navigation and cleans up on close", () => {
    const start = source.indexOf("export const openFlashcardV2SourceEditor =");
    const end = source.indexOf("export const openFlashcardV2ReviewSession", start);
    const script = compile(source.slice(start, end).replace("export const", "const") + "\nopenFlashcardV2SourceEditor;");
    let dialogOptions: {destroyCallback: () => void};
    let protyleOptions: {blockId: string, action: string[]};
    let destroyed = 0;
    let returned = 0;
    const open = runInNewContext(script, {
        window: {siyuan: {languages: {edit: "Edit"}}}, isMobile: () => false,
        Constants: {CB_GET_ALL: "all", CB_GET_FOCUS: "focus", CB_GET_SCROLL: "scroll"},
        Dialog: class {
            element = {querySelector: () => ({})};
            constructor(options: typeof dialogOptions) { dialogOptions = options; }
        },
        Protyle: class {
            constructor(_app: unknown, _element: unknown, options: typeof protyleOptions) { protyleOptions = options; }
            resize() {}
            destroy() { destroyed++; }
        },
    }) as (app: unknown, blockID: string, callback: () => void, locate?: boolean) => void;
    open({}, "ordinary", () => { returned++; });
    assert.deepEqual(Array.from(protyleOptions.action), ["all"]);
    dialogOptions.destroyCallback();
    open({}, "heading", () => { returned++; }, true);
    assert.equal(protyleOptions.blockId, "heading");
    assert.deepEqual(Array.from(protyleOptions.action), ["all", "focus", "scroll"]);
    dialogOptions.destroyCallback();
    assert.equal(destroyed, 2);
    assert.equal(returned, 2);
});
