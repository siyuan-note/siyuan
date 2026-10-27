import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {isUndoViewportPreserved, preserveUndoViewport} from "./viewport";

test("canvas history suppresses caret scrolling only in its editor and releases nested scopes independently", () => {
    const scrolled: unknown[] = [];
    class Target {
        getBoundingClientRect() { return {top: -300, bottom: -200, height: 100}; }
    }
    const root = {closest: (): null => null} as unknown as Element;
    const other = {closest: (): null => null} as unknown as Element;
    const editor = (element: Element) => ({wysiwyg: {element}, contentElement: {
        scrollTop: 500, getBoundingClientRect: () => ({top: 0, bottom: 400, height: 400}),
        scroll: (options: unknown) => scrolled.push(options),
    }});
    const code = transpileModule(readFileSync("src/util/highlightById.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: {scrollCenter?: (owner: unknown, target: unknown) => void} = {};
    runInNewContext(code, {exports, HTMLElement: Target, getSelection: () => ({rangeCount: 0}),
        require: () => ({isUndoViewportPreserved, resolveVisibleListMindmapBlock: (): undefined => undefined,
            revealTabsForTarget() {}})});
    const stop = preserveUndoViewport(root);
    const stopNested = preserveUndoViewport(root);
    exports.scrollCenter(editor(root), new Target());
    assert.equal(scrolled.length, 0);
    exports.scrollCenter(editor(other), new Target());
    assert.equal(scrolled.length, 1, "history does not block scrolling another document");
    stop(); stop();
    exports.scrollCenter(editor(root), new Target());
    assert.equal(scrolled.length, 1, "disposing twice cannot release the nested operation");
    stopNested();
    exports.scrollCenter(editor(root), new Target());
    assert.equal(scrolled.length, 2, "ordinary caret scrolling resumes after history");
    assert.equal(isUndoViewportPreserved(root), false);
});

test("embedded history retains its viewport choice until asynchronous rendering finishes", () => {
    const source = readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8");
    const start = source.indexOf("    const preserveViewport = isUndoViewportPreserved(");
    const end = source.indexOf("    queueHeadingNumberRefresh", start);
    assert.ok(start > 0 && end > start);
    const code = transpileModule(source.slice(start, end), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    let complete: () => void;
    let focused = 0;
    let scrolled = 0;
    const root = {} as Element;
    const replay = new Function("isUndoViewportPreserved", "protyle", "pendingUndoEmbedElements", "blockRender",
        "restoreUndoFocus", "scrollCenter", "operations", code);
    const render = () => replay(isUndoViewportPreserved, {wysiwyg: {element: root}},
        new Set([{isConnected: true, removeAttribute() {}}]),
        (_owner: unknown, _item: unknown, _options: unknown, callback: () => void) => complete = callback,
        () => { focused++; return true; }, () => scrolled++, []);
    const release = preserveUndoViewport(root);
    render(); release(); complete();
    assert.equal(focused, 1, "embedded selection restoration still finishes");
    assert.equal(scrolled, 0, "late rendering cannot scroll after the history request has completed");
    render(); complete();
    assert.equal(scrolled, 1, "ordinary embedded history retains its caret scrolling");
});
