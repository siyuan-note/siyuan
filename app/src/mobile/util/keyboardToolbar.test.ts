import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import * as gutterVisibility from "../../protyle/ui/gutterVisibility";
import * as touchSelection from "./touchSelection";

const {setGutterTouchDragging} = gutterVisibility;
const source = createSourceFile("keyboardToolbar.ts", readFileSync("src/mobile/util/keyboardToolbar.ts", "utf8"),
    ScriptTarget.Latest, true);
const declaration = source.statements.find(node => isVariableStatement(node) &&
    node.declarationList.declarations.some(item => item.name.getText(source) === "hideKeyboardToolbarByApp"));
assert.ok(declaration);
const compiled = transpileModule(`${declaration.getText(source).replace(/^export /, "")}\nhideKeyboardToolbarByApp;`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    const gutter = {} as HTMLElement;
    const calls: string[] = [];
    let editor: unknown = {protyle: {gutter: {element: gutter}, wysiwyg: {element: {contains: () => true}}}};
    let text = "";
    let tableSelection = false;
    const selection = {rangeCount: 1, getRangeAt: () => ({collapsed: !text, startContainer: {}, endContainer: {}}),
        removeAllRanges: () => calls.push("clear-selection")};
    const hide = runInNewContext(compiled, {
        ...touchSelection, ...gutterVisibility,
        inlineMathSelection: {reset: () => calls.push("reset-math")},
        preventKeyboardToolbarRender: () => calls.push("prevent-render"),
        hideKeyboardToolbar: () => calls.push("hide-toolbar"),
        restoreRecentAndroidTableCellSelectAll: () => { calls.push("restore-table"); return tableSelection; },
        getCurrentEditor: () => editor, getSelection: () => selection,
        hideElements: () => calls.push("hide-utils"), stripSemanticMarkersFromRangeText: () => text,
        keyboardPanelTop: undefined,
        document: {activeElement: {tagName: "DIV", blur: () => calls.push("blur")}},
    });
    return {gutter, calls, selection, hide,
        setText: (value: string) => text = value,
        setTableSelection: () => tableSelection = true,
        removeEditor: (): void => { editor = undefined; }};
};

for (const preserveSelection of [true, false]) {
    for (const range of ["caret", "cleared", "text"]) {
        test(`keyboard hide preserves the touched gutter's focus (${preserveSelection}, ${range})`, () => {
            const f = fixture();
            if (range === "cleared") f.selection.rangeCount = 0;
            if (range === "text") f.setText("selected text");
            setGutterTouchDragging(f.gutter, true);
            assert.equal(f.hide(preserveSelection), touchSelection.KeyboardHideResult.PreserveSelection);
            assert.ok(f.calls.includes("hide-toolbar"), "the keyboard toolbar still closes");
            assert.ok(f.calls.includes("prevent-render"));
            assert.ok(!f.calls.includes("blur"));
            assert.ok(!f.calls.includes("clear-selection"));
            setGutterTouchDragging(f.gutter, false);
        });
    }
}

test("gutter dragging does not reopen the keyboard from a recent table selection", () => {
    const f = fixture();
    f.setTableSelection();
    setGutterTouchDragging(f.gutter, true);
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.PreserveSelection);
    assert.ok(!f.calls.includes("restore-table"));
    setGutterTouchDragging(f.gutter, false);
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.RestoreTableCellSelection);
});

test("keyboard cleanup resumes after the gutter gesture and leaves other editors alone", () => {
    const f = fixture();
    setGutterTouchDragging({} as HTMLElement, true);
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.Cleanup);
    setGutterTouchDragging(f.gutter, true);
    setGutterTouchDragging(f.gutter, false);
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.Cleanup);
    f.setText("selected text");
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.PreserveSelection);
    assert.equal(f.hide(false), touchSelection.KeyboardHideResult.Cleanup);
    assert.ok(f.calls.includes("blur"));
    assert.ok(f.calls.includes("clear-selection"));
    f.removeEditor();
    assert.equal(f.hide(true), touchSelection.KeyboardHideResult.Cleanup);
});
