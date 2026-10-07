import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {createKeyboardSelectionScroll} from "./keyboardSelectionScroll";
import {getCaretOverflowDirection, getCaretScrollDelta} from "../../protyle/wysiwyg/caretScrollCore";

const source = createSourceFile("keyboardToolbar.ts", readFileSync(join(__dirname, "keyboardToolbar.ts"), "utf8"),
    ScriptTarget.Latest, true);
const declarations = source.statements.filter(node => isVariableStatement(node) &&
    node.declarationList.declarations.some(item =>
        ["scrollKeyboardSelectionIntoView", "scrollKeyboardSelection"].includes(item.name.getText(source))));
assert.equal(declarations.length, 2);
const code = transpileModule(declarations.map(node => node.getText(source)).join("\n") +
    "\n({scrollKeyboardSelectionIntoView, scrollKeyboardSelection});", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

class Content extends EventTarget {
    public isConnected = true;
    public scrollTop = 180;
    public scrollLeft = 12;
    public calls: ScrollToOptions[] = [];

    getBoundingClientRect() {
        return {top: 200, bottom: 320};
    }

    scroll(options: ScrollToOptions) {
        this.calls.push(options);
        this.scrollTop = options.top;
    }
}

const setup = () => {
    const content = new Content();
    const cursor = {nodeType: 1};
    const range = {startContainer: cursor, endContainer: cursor, cloneRange: () => range};
    const selection = {rangeCount: 1, anchorNode: cursor, anchorOffset: 0, focusNode: cursor, focusOffset: 0,
        getRangeAt: () => range};
    const state = {cursorTop: 350, viewportBottom: 600, hidden: false, showUtil: false, focused: true, multi: false};
    const toolbar = {classList: {contains: () => state.hidden}, getBoundingClientRect: () => ({top: 400})};
    const protyle = {toolbar: {isMultiSelectMode: () => state.multi}, wysiwyg: {element: {
        contains: (node: unknown) => node === cursor && state.focused,
    }}};
    let current: {protyle: typeof protyle} | undefined = {protyle};
    const timers = new Map<number, {callback: () => void, delay: number}>();
    let nextTimer = 0;
    const setTimer = (callback: () => void, delay: number) => {
        timers.set(++nextTimer, {callback, delay});
        return nextTimer;
    };
    const clearTimer = (id: number) => { timers.delete(id); };
    const context = {
        document: {getElementById: () => toolbar, activeElement: cursor},
        window: {setTimeout: setTimer, siyuan: {mobile: {touchRange: {startContainer: {}}},
            config: {editor: {fontSize: 14}}}},
        clearTimeout: clearTimer, Constants: {TIMEOUT_COUNT: 1000},
        getCurrentEditor: () => current, getSelection: () => selection,
        hasClosestByClassName: (node: unknown) => node === cursor ? content : undefined,
        getVisibleViewportBounds: () => ({top: 0, bottom: state.viewportBottom}),
        getSelectionPosition: () => ({top: state.cursorTop}), getComputedStyle: () => ({lineHeight: "22px"}),
        getCaretOverflowDirection, getCaretScrollDelta,
        Node: {ELEMENT_NODE: 1}, showUtil: false, clearRenderGutterAfterScroll: undefined as (() => void) | undefined,
        restoreGutterBySelection() {}, pauseMobileBarsScroll() {},
        keyboardSelectionScroll: undefined as ReturnType<typeof createKeyboardSelectionScroll> | undefined,
    };
    context.keyboardSelectionScroll = createKeyboardSelectionScroll({
        delay: 300, setTimer, clearTimer,
        scroll: container => api.scrollKeyboardSelection(container),
        onCancel: () => context.clearRenderGutterAfterScroll?.(),
    });
    const api: {scrollKeyboardSelectionIntoView: (force?: boolean) => void,
        scrollKeyboardSelection: (container: HTMLElement) => boolean} = runInNewContext(code, context);
    const flush = () => {
        [...timers.entries()].filter(([, task]) => task.delay === 300).forEach(([id, task]) => {
            timers.delete(id);
            task.callback();
        });
    };
    return {api, content, state, selection, context, flush, leaveEditor: () => { current = undefined; }};
};

test("mobile toolbar positioning yields to a swipe even after repeated selection refreshes", () => {
    const s = setup();
    s.state.cursorTop = 250;
    s.api.scrollKeyboardSelectionIntoView();
    s.content.dispatchEvent(new Event("touchstart"));
    s.content.dispatchEvent(new Event("touchmove"));
    s.content.scrollTop = 350;
    s.state.cursorTop = 80;
    s.api.scrollKeyboardSelectionIntoView();
    s.content.dispatchEvent(new Event("touchend"));
    s.api.scrollKeyboardSelectionIntoView();
    s.flush();
    assert.equal(s.content.calls.length, 0);
    assert.equal(s.content.scrollTop, 350);
    s.selection.focusOffset++;
    s.api.scrollKeyboardSelectionIntoView();
    s.flush();
    assert.ok(s.content.calls[0].top < 350, "a later caret move can scroll upwards");
});

test("positioning uses the crossed viewport edge and preserves the current selection", () => {
    for (const [cursorTop, expectedTop] of [[180, 138], [-20, -62], [350, 254], [250, undefined]]) {
        const s = setup();
        s.state.cursorTop = cursorTop;
        s.api.scrollKeyboardSelectionIntoView();
        s.flush();
        assert.equal(s.content.calls[0]?.top, expectedTop);
        if (expectedTop !== undefined) {
            assert.equal(s.content.calls[0].left, 12);
            assert.equal(s.content.calls[0].behavior, "smooth");
        }
    }
});

test("input and keyboard viewport changes still position the caret after manual browsing", () => {
    for (const reason of ["input", "viewport"]) {
        const s = setup();
        s.state.cursorTop = 250;
        s.api.scrollKeyboardSelectionIntoView();
        s.flush();
        s.content.dispatchEvent(new Event("wheel"));
        if (reason === "input") {
            s.state.cursorTop = 350;
        } else {
            s.state.viewportBottom = 260;
        }
        s.api.scrollKeyboardSelectionIntoView(reason === "input");
        s.flush();
        assert.equal(s.content.calls.length, 1, reason);
    }
});

test("delayed positioning checks editor, focus, toolbar, selection and detached-container state", () => {
    for (const change of ["editor", "focus", "hidden", "panel", "multi", "range", "detached"]) {
        const s = setup();
        s.api.scrollKeyboardSelectionIntoView();
        if (change === "editor") {
            s.leaveEditor();
        } else if (change === "focus") {
            s.state.focused = false;
        } else if (change === "hidden") {
            s.state.hidden = true;
        } else if (change === "panel") {
            s.context.showUtil = true;
        } else if (change === "multi") {
            s.state.multi = true;
        } else if (change === "range") {
            s.selection.rangeCount = 0;
        } else {
            s.content.isConnected = false;
        }
        s.flush();
        assert.equal(s.content.calls.length, 0, change);
    }
});
