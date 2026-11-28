import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isVariableStatement, Node, ScriptTarget, transpileModule} from "typescript";
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

test("keyboard quick card uses the editable block at the caret", () => {
    const declaration = source.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(source) === "getMobileQuickCardBlockID"));
    assert.ok(declaration);
    const code = transpileModule(`${declaration.getText(source)}\ngetMobileQuickCardBlockID;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const editor = {};
    const node = {isConnected: true};
    let owner = editor;
    let embedded = false;
    let type = "NodeParagraph";
    const config = {readonly: false};
    const getBlockID = runInNewContext(code, {
        window: {siyuan: {config}},
        hasClosestByClassName: () => owner,
        hasClosestBlock: () => ({
            getAttribute: (name: string) => name === "data-type" ? type : "sample-block",
            closest: () => embedded,
        }),
    });
    const protyle = {block: {rootID: "doc"}, wysiwyg: {element: editor}};
    const caret = {startContainer: node, collapsed: true};
    assert.equal(getBlockID(protyle, caret), "sample-block");
    assert.equal(getBlockID(protyle, {...caret, collapsed: false}), undefined);
    assert.equal(getBlockID({...protyle, disabled: true}, caret), undefined);
    assert.equal(getBlockID({...protyle, lite: true}, caret), undefined);
    config.readonly = true;
    assert.equal(getBlockID(protyle, caret), undefined);
    config.readonly = false;
    embedded = true;
    assert.equal(getBlockID(protyle, caret), undefined);
    embedded = false;
    type = "NodeThematicBreak";
    assert.equal(getBlockID(protyle, caret), undefined);
    type = "NodeParagraph";
    owner = {};
    assert.equal(getBlockID(protyle, caret), undefined);
});

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

test("mobile emoji insertion replaces the insert menu without restoring the keyboard", async () => {
    let handler: string;
    const visit = (node: Node) => {
        if (isCallExpression(node) && node.expression.getText(source) === "toolbarElement.addEventListener" &&
            node.arguments[0].getText(source).includes('"touchend"')) {
            handler = node.arguments[1].getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(handler);
    const code = transpileModule(`(${handler})`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    for (const lite of [false, true]) {
        const calls: string[] = [];
        const button = {
            dataset: {slashEntryKey: "emoji"},
            getAttribute: (name: string) => ({"data-value": "emoji", "data-focus": "true"})[name] ?? null,
        };
        const body = {};
        const protyle = {
            toolbar: {range: {}}, wysiwyg: {element: {}},
            hint: {fillCommand: (value: string, owner: unknown, updateRange: boolean, entryKey: string) => {
                assert.equal(owner, protyle);
                assert.deepEqual([value, updateRange, entryKey], ["emoji", false, "emoji"]);
                calls.push("open emoji panel");
            }},
        };
        const click = runInNewContext(code, {
            takeMenuKeyboard() {}, moved: false, getCurrentEditor: () => ({protyle}),
            hasClosestByClassName: () => button, Constants: {ZWSP: "\u200b"},
            hideKeyboardToolbarUtil: (restoreKeyboard = false) => calls.push(restoreKeyboard ? "wait for keyboard" : "close insert menu"),
            hideKeyboardToolbar: (keyboardClosed: boolean) => {
                assert.equal(keyboardClosed, false);
                calls.push("hide toolbar");
            },
            getSelection: () => ({rangeCount: 0}), getEditorFocusRange: () => protyle.toolbar.range,
            document: {body, activeElement: body},
            restoreKeyboardToolbarRange: () => calls.push("restore keyboard"),
            showKeyboardToolbar: () => calls.push("show toolbar"),
        });
        await click({
            target: {closest: (selector: string) => lite && selector.startsWith(".keyboard__util ") ? button : null},
            preventDefault() {}, stopPropagation() {},
        });
        assert.deepEqual(calls, ["close insert menu", "open emoji panel", "hide toolbar"], lite ? "lite menu" : "regular menu");
    }
});
