import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isVariableDeclaration, Node, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("keyboardToolbar.ts", readFileSync(join(__dirname, "keyboardToolbar.ts"), "utf8"), ScriptTarget.Latest);
let handlerSource: string;
let keyboardSource: string;
let entriesSource: string;
const visit = (node: Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "toolbarElement.addEventListener" &&
        node.arguments[0].getText(source).includes('"touchend"')) {
        handlerSource = node.arguments[1].getText(source);
    }
    if (isVariableDeclaration(node) && node.name.getText(source) === "keepBlockHintKeyboard") {
        keyboardSource = node.initializer.getText(source);
    }
    if (isVariableDeclaration(node) && node.name.getText(source) === "applyKeyboardToolbarEntries") {
        entriesSource = node.initializer.getText(source);
    }
    forEachChild(node, visit);
};
visit(source);
assert.ok(handlerSource && keyboardSource && entriesSource);
const compile = (text: string) => transpileModule(`(${text})`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

test("mobile reference remains available at a caret without exposing other selection-only tools", () => {
    for (const hasText of [true, false]) {
        for (const inCode of [true, false]) {
            for (const hasRange of [true, false]) {
                const protyle = {wysiwyg: {element: {contains: () => true}}};
                const apply = runInNewContext(compile(entriesSource), {
                    getCurrentEditor: () => ({protyle}),
                    getSelection: () => ({rangeCount: hasRange ? 1 : 0, getRangeAt: () => ({})}),
                    hasClosestBlock: () => ({classList: {contains: () => inCode}}),
                    stripSemanticMarkersFromRangeText: () => hasText ? "selected" : "",
                    Constants: {ZWSP: "\u200b"}, getEntryOrder: (): string[] => [], isEntryVisible: () => false,
                    TOOLBAR_ENTRY_ROOT_PATH: "editor.toolbar", MOBILE_TOOLBAR_NAMES: ["block-ref", "strong"],
                    MOBILE_TOOLBAR_ACTION_NAMES: [],
                    applyMobileToolbarEntries: (_element: unknown, _toolbar: unknown, options: {
                        isAvailable: (name: string) => boolean, isVisible: (key: string) => boolean,
                    }) => {
                        assert.equal(options.isAvailable("block-ref"), hasRange && !inCode);
                        assert.equal(options.isAvailable("strong"), hasRange && hasText && !inCode);
                        assert.equal(options.isVisible("block-ref"), false);
                    },
                });
                apply({}, []);
            }
        }
    }
});

const setup = (options: {collapsed?: boolean, type?: string, disabled?: boolean, readonly?: boolean,
    code?: boolean, editorDisabled?: boolean, moved?: boolean, missingRange?: boolean} = {}) => {
    const calls: string[] = [];
    const savedRange = {};
    const range = {collapsed: options.collapsed !== false, startContainer: {}, cloneRange: () => savedRange};
    const button = {
        hasAttribute: () => !!options.disabled,
        getAttribute: () => options.type || "block-ref",
        classList: {contains: () => false},
    };
    const protyle = {
        disabled: !!options.editorDisabled,
        toolbar: {
            range: {},
            element: {querySelector: (selector: string) => ({dispatchEvent: () => calls.push(selector)})},
        },
        hint: {fillCommand: (value: string, owner: unknown, updateRange: boolean) => {
            assert.equal(value, "((");
            assert.equal(owner, protyle);
            assert.equal(updateRange, false);
            assert.equal(protyle.toolbar.range, savedRange);
            calls.push("insert");
        }},
    };
    const handler = runInNewContext(compile(handlerSource), {
        takeMenuKeyboard() {}, moved: !!options.moved,
        getCurrentEditor: () => ({protyle}), hasClosestByClassName: (): null => null,
        hasClosestByTag: () => button, hasClosestByAttribute: () => !!options.code,
        getSelection: () => ({rangeCount: options.missingRange ? 0 : 1, getRangeAt: () => range}),
        window: {siyuan: {config: {readonly: !!options.readonly}}},
        hasClosestBlock: () => ({}), MOBILE_TOOLBAR_INSERTS: [],
        hideElements: () => calls.push("hide"),
        keepBlockHintKeyboard: (owner: unknown) => { assert.equal(owner, protyle); calls.push("keyboard"); },
        CustomEvent: class {},
    });
    return {calls, run: () => handler({target: {closest: (): null => null}, preventDefault() {}, stopPropagation() {}})};
};

test("collapsed mobile reference inserts the existing command using the current range", async () => {
    const scenario = setup();
    await scenario.run();
    assert.deepEqual(scenario.calls, ["hide", "insert", "keyboard"]);
});

test("selected text and other inline tools retain their shared toolbar handlers", async () => {
    for (const options of [{collapsed: false}, {type: "a"}, {type: "inline-math"}, {type: "inline-memo"}]) {
        const scenario = setup(options);
        await scenario.run();
        assert.deepEqual(scenario.calls, ["hide", `[data-type="${options.type || "block-ref"}"]`]);
    }
});

test("reference insertion retains disabled, readonly, code, gesture and range guards", async () => {
    for (const options of [{disabled: true}, {readonly: true}, {editorDisabled: true},
        {code: true}, {moved: true}, {missingRange: true}]) {
        const scenario = setup(options);
        await scenario.run();
        assert.deepEqual(scenario.calls, []);
    }
});

test("block hints preserve the keyboard and only restore the current attached editor range", () => {
    for (const platform of ["android", "harmony", "ios"]) {
        for (const change of ["none", "editor", "range", "detached", "outside"]) {
            const calls: string[] = [];
            let callback: () => void;
            const node = {isConnected: true};
            const range = {startContainer: node, endContainer: node};
            let inside = true;
            const protyle = {toolbar: {range}, wysiwyg: {element: {contains: () => inside}}};
            let current = protyle;
            const keepKeyboard = runInNewContext(compile(keyboardSource), {
                hideKeyboardToolbarUtil: () => calls.push("hide"),
                callMobileAppShowKeyboard: () => calls.push("keyboard"),
                isInAndroid: () => platform === "android", isInHarmony: () => platform === "harmony",
                getCurrentEditor: () => ({protyle: current}), Constants: {TIMEOUT_TRANSITION: 200},
                setTimeout: (fn: () => void) => { callback = fn; },
                focusByRange: (value: unknown) => { assert.equal(value, range); calls.push("focus"); },
            });
            keepKeyboard(protyle);
            if (change === "editor") {
                current = undefined;
            } else if (change === "range") {
                protyle.toolbar.range = {...range};
            } else if (change === "detached") {
                node.isConnected = false;
            } else if (change === "outside") {
                inside = false;
            }
            callback?.();
            assert.deepEqual(calls, platform !== "ios" && change === "none" ?
                ["hide", "keyboard", "focus"] : ["hide", "keyboard"]);
        }
    }
});
