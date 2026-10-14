import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createSourceFile, isArrowFunction, isCallExpression, isVariableDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("editor.ts", readFileSync("src/protyle/render/listMindmap/editor.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declarations = new Map<string, string>();
let pointerHandler: string;
let keyboardCapture = false;
const visit = (item: import("typescript").Node) => {
    if (isVariableDeclaration(item) && ["save", "captureBeforeChange"].includes(item.name.getText(source))) {
        declarations.set(item.name.getText(source), item.getText(source));
    }
    if (isCallExpression(item) && item.expression.getText(source) === "document.addEventListener" &&
        item.arguments[0]?.getText(source) === '"pointerdown"' && isArrowFunction(item.arguments[1]) &&
        item.arguments[1].getText(source).includes("!belongs")) {
        pointerHandler = item.arguments[1].getText(source);
    }
    if (isCallExpression(item) && item.expression.getText(source) === "host.addEventListener" &&
        item.arguments[0]?.getText(source) === '"keydown"' && item.arguments[1]?.getText(source) === "captureBeforeChange") {
        keyboardCapture = item.arguments[2]?.getText(source).includes("capture: true");
    }
    item.forEachChild(visit);
};
visit(source);
assert.equal(declarations.size, 2);
assert.ok(pointerHandler);
assert.equal(keyboardCapture, true);
const compiled = transpileModule([...declarations.values()].map(value => `const ${value};`).join("\n"),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
const pointerCode = transpileModule(`const pointerdown = ${pointerHandler};`,
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const create = (initial: string, initialSelection: Record<string, string>) => {
    const state = {html: initial, source: initial, selection: initialSelection, barrier: undefined as Promise<void> | undefined,
        saves: [] as {html: string, undo: Record<string, string>, redo: Record<string, string>}[]};
    const factory = new Function("state", "assert", `
        let finished = false, closing = false, composing = false, saving = false, changed = false;
        let saveTimer, lastHTML = state.html, source = state.source;
        let undoSelection = state.selection, lastSelection = state.selection;
        const clearTimeout = () => {}, window = {setTimeout: () => 1};
        const comparableContent = value => value, cleanListMindmapHTML = value => value;
        const retainIndependentBlocks = value => value, captureSelection = () => state.selection;
        const node = {element: {isConnected: true}}, nodeContent = () => state.source;
        const recover = () => assert.fail('Unexpected source conflict');
        const fragment = {getBlockHTML: () => state.html, wysiwyg: {children: []},
            protyle: {wysiwyg: {flushPendingInput: async () => {}}}};
        const options = {canEdit: () => true, onSave: async (html, undo, redo) => {
            state.saves.push({html, undo, redo});
            await state.barrier;
            state.source = html;
            return true;
        }};
        const belongs = target => target === 'toolbar', finish = () => {};
        ${compiled}
        ${pointerCode}
        return {save, captureBeforeChange, pointerdown, currentUndo: () => undoSelection};
    `);
    return {state, editor: factory(state, assert)};
};

test("mind map save binds both selection snapshots to their own content batch, including input during a save", async () => {
    const before = {undoFocusId: "first", undoFocusEndId: "second", undoFocusStart: "3", undoFocusEnd: "1",
        undoFocusIgnoreZWSP: "true", backward: "true"};
    const after = {...before, undoFocusEndId: "first", undoFocusStart: "4", undoFocusEnd: "4", backward: "false"};
    const next = {...after, undoFocusStart: "5", undoFocusEnd: "5"};
    const {state, editor} = create("A😀BC\n中文", before);
    editor.captureBeforeChange();
    state.html = "A😀XC\n中文";
    state.selection = after;
    let release: () => void;
    state.barrier = new Promise<void>(resolve => { release = resolve; });
    const saving = editor.save(false);
    await Promise.resolve();
    assert.equal(state.saves.length, 1);
    state.html = "A😀XYC\n中文";
    state.selection = next;
    release();
    assert.equal(await saving, true);
    assert.deepEqual(state.saves[0], {html: "A😀XC\n中文", undo: before, redo: after});
    assert.equal(editor.currentUndo(), after, "the following batch starts at the prior committed selection");
    editor.captureBeforeChange();
    assert.equal(await editor.save(true), true);
    assert.deepEqual(state.saves[1], {html: "A😀XYC\n中文", undo: after, redo: next});
});

test("unchanged content and an outside selection do not replace the last valid editing history", async () => {
    const selection = {undoFocusId: "paragraph", undoFocusStart: "2", undoFocusEnd: "2"};
    const {state, editor} = create("中文😀", selection);
    state.selection = undefined;
    editor.captureBeforeChange();
    assert.equal(editor.currentUndo(), selection);
    assert.equal(await editor.save(true), true);
    assert.equal(state.saves.length, 0);
    state.html = "中文😀x";
    assert.equal(await editor.save(true), true);
    assert.equal(state.saves[0].undo, selection);
    assert.equal(state.saves[0].redo, selection);
});

test("floating toolbar captures the selected text before formatting, while undo keydown preserves a pending batch origin", async () => {
    const caret = {undoFocusId: "paragraph", undoFocusStart: "0", undoFocusEnd: "0"};
    const selected = {...caret, undoFocusStart: "2", undoFocusEnd: "4"};
    const {state, editor} = create("ABCDE", caret);
    state.selection = selected;
    editor.pointerdown({target: "toolbar"});
    assert.equal(editor.currentUndo(), selected, "document capture runs before the overlay formats its selected text");
    state.html = "AB<strong>CD</strong>E";
    state.selection = {...caret, undoFocusStart: "4", undoFocusEnd: "4"};
    assert.equal(await editor.save(true), true);
    assert.equal(state.saves[0].undo, selected);

    const pending = create("", caret);
    pending.editor.captureBeforeChange();
    pending.state.html = "x";
    pending.state.selection = {...caret, undoFocusStart: "1", undoFocusEnd: "1"};
    pending.editor.captureBeforeChange(); // 实际 keydown capture 在 Ctrl+Z 处理器之前执行。
    assert.equal(await pending.editor.save(true), true);
    assert.equal(pending.state.saves[0].undo, caret, "undo keydown must not replace the pre-input selection with the current caret");
});
