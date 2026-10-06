import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {createMobileKeyboardChangeNotifier} from "./mobileKeyboardChange";

const source = createSourceFile("keyboardToolbar.ts", readFileSync(join(__dirname, "keyboardToolbar.ts"), "utf8"), ScriptTarget.Latest);
const extract = (name: string) => {
    const declaration = source.statements.find(node => isVariableStatement(node) &&
        node.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration, name);
    return declaration.getText(source).replace(/^export /, "");
};

test("a non-editable video focus hides editing controls without reporting a system keyboard close", () => {
    const changes: boolean[] = [];
    const timers = new Map<number, () => void>();
    const notify = createMobileKeyboardChangeNotifier({
        dispatch: open => changes.push(open),
        setTimer: callback => { timers.set(1, callback); return 1; },
        clearTimer: timer => { timers.delete(timer); },
    });
    const classes = new Set<string>();
    const toolbar = {classList: {
        contains: (name: string) => classes.has(name), add: (name: string) => { classes.add(name); },
    }, style: {height: "48px"}};
    let frame: () => void;
    const context = {
        window: {requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; }, cancelAnimationFrame() {}},
        document: {activeElement: {tagName: "VIDEO"}, getElementById: (id: string) => id === "keyboardToolbar" ? toolbar :
            {style: {transform: ""}}},
        renderKeyboardToolbarFrame: undefined as number | undefined, scrollSelectionIntoViewTimeout: undefined as number | undefined,
        clearRenderGutterAfterScroll: undefined as (() => void) | undefined, showUtil: false,
        keyboardPanelTop: undefined as number | undefined,
        pendingKeyboardFocus: undefined as {protyle: unknown, range: unknown} | undefined,
        canInput: () => false, getCurrentEditor: (): undefined => undefined,
        clearTimeout() {}, notifyMobileKeyboardChange: notify,
    };
    const code = transpileModule([extract("hideKeyboardToolbar"), extract("renderKeyboardToolbar"),
        "({hideKeyboardToolbar, renderKeyboardToolbar})"].join("\n"), {compilerOptions: {target: ScriptTarget.ES2020}}).outputText;
    const api = runInNewContext(code, context);
    notify(true);
    api.renderKeyboardToolbar();
    frame();
    assert.ok(classes.has("fn__none"));
    assert.deepEqual(changes, [true]);
    assert.equal(timers.size, 0, "tool visibility changes must not schedule a keyboard close");

    api.hideKeyboardToolbar();
    [...timers.values()].forEach(callback => callback());
    assert.deepEqual(changes, [true, false], "the native keyboard close still restores navigation");
});

test("video insertion hands the menu back to the keyboard and restores the paragraph range after native focus", () => {
    for (const platform of ["android", "harmony", "ios"]) {
        const calls: string[] = [];
        const range = {startContainer: {isConnected: true}, endContainer: {isConnected: true}};
        const protyle = {wysiwyg: {element: {}}, toolbar: {range: undefined as typeof range | undefined}};
        const context = {
            getCurrentEditor: () => ({protyle}),
            getEditorFocusRange: () => range,
            pendingKeyboardFocus: undefined as {protyle: unknown, range: unknown} | undefined,
            isInAndroid: () => platform === "android", isInHarmony: () => platform === "harmony",
            callMobileAppShowKeyboard: () => calls.push("native-show"),
            restoreEditorFocusRange: (editor: unknown, target: unknown) => {
                assert.equal(editor, protyle.wysiwyg.element);
                assert.equal(target, range);
                calls.push("focus");
                return true;
            },
            hideKeyboardToolbarUtilOnEditorClick: () => calls.push("close-panel"),
            showKeyboardToolbar: () => calls.push("show-toolbar"),
        };
        const code = transpileModule([extract("restoreKeyboardToolbarRange"), extract("resumeMobileEditorAfterInsertion"),
            "resumeMobileEditorAfterInsertion"].join("\n"), {compilerOptions: {target: ScriptTarget.ES2020}}).outputText;
        runInNewContext(code, context)(protyle, range);
        assert.deepEqual(calls, platform === "ios" ? ["close-panel", "focus", "show-toolbar"] :
            ["close-panel", "native-show", "focus", "show-toolbar"]);
        assert.equal(context.pendingKeyboardFocus?.range, platform === "ios" ? undefined : range);
    }
});
