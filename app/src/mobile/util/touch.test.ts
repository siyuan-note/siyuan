import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as touchSelection from "./touchSelection";

const compiled = transpileModule(readFileSync("src/mobile/util/touch.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (text = "\u200b\n", collapsed = false, inside = true) => {
    const exports: any = {};
    let blurCount = 0;
    let focusCount = 0;
    let keyboardHidden = false;
    const startContainer = {isConnected: true};
    const endContainer = {isConnected: true};
    let range = {
        collapsed,
        startContainer,
        endContainer,
        startOffset: 1,
        endOffset: 2,
        cloneRange() {
            return {...this};
        },
    };
    const selection = {
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges() {
            this.rangeCount = 0;
        },
        addRange(value: typeof range) {
            range = value;
            this.rangeCount = 1;
        },
        collapseToStart() {
            range.collapsed = true;
            range.endContainer = range.startContainer;
            range.endOffset = range.startOffset;
        },
    };
    const mobile: any = {};
    const element = {tagName: "DIV", dataset: {}, contains: () => inside, closest: (): null => null};
    const editor = {protyle: {wysiwyg: {element}, toolbar: {isMultiSelectMode: () => false}}};
    const body = {};
    const document: any = {body, activeElement: body, querySelector: (): null => null,
        getElementById: () => ({classList: {contains: () => keyboardHidden}})};
    const editable = {isContentEditable: true, isConnected: true, focus: () => {
        focusCount++;
        document.activeElement = editable;
    }};
    const modules: Record<string, unknown> = {
        "./sidebar": {getSidebarElement: (): null => null},
        "./touchPanelGesture": {setSidebarSwipeState: () => {}},
        "./keyboardToolbar": {
            resetAndroidBoundedSelectionGesture: () => {},
            activeBlur: () => blurCount++,
        },
        "../editor": {getCurrentEditor: () => editor},
        "../../constants": {Constants: {TIMEOUT_MULTIPLE_SELECT: 1500}},
        "../../protyle/util/hasClosest": {hasClosestBlock: (): null => null, hasClosestByAttribute: (): null => null,
            hasClosestByClassName: (): null => null},
        "../../protyle/util/compatibility": {isIPhone: () => false},
        "./touchSelection": touchSelection,
        "../../protyle/util/inlineElementMarker": {stripSemanticMarkersFromRangeText: () => text},
    };
    runInNewContext(compiled, {
        exports,
        require: (name: string) => modules[name] || {},
        document,
        getSelection: () => selection,
        window: {innerWidth: 384, innerHeight: 808, getSelection: () => selection, siyuan: {mobile}},
    });
    const startBlankTouch = (target = element, count = 1) => {
        document.activeElement = editable;
        exports.handleTouchStart({target, touches: Array.from({length: count}, () =>
            ({target, clientX: 100, clientY: 100}))});
    };
    const contextMenu = (target = element) => {
        const event = {target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
        exports.handleTouchContextMenu(event);
        return event;
    };
    return {exports, selection, range, mobile, document, editable, element, editor, startBlankTouch, contextMenu,
        hideKeyboard: () => { keyboardHidden = true; }, focusCount: () => focusCount, blurCount: () => blurCount};
};

test("releasing a blank editor selection preserves the caret and keyboard", () => {
    const f = fixture();
    f.exports.handleTouchUp();
    assert.equal(f.blurCount(), 0);
    assert.equal(f.selection.rangeCount, 1);
    assert.equal(f.range.collapsed, true);
    assert.equal(f.range.endContainer, f.range.startContainer);
    assert.equal(f.range.endOffset, f.range.startOffset);
    assert.equal(f.mobile.touchRange.collapsed, true);
    assert.notEqual(f.mobile.touchRange, f.range);
});

test("canceling a touch over blank content preserves the caret and keyboard", () => {
    const f = fixture();
    f.exports.handleTouchCancel();
    assert.equal(f.blurCount(), 0);
    assert.equal(f.selection.rangeCount, 1);
    assert.equal(f.range.collapsed, true);
});

test("touch cleanup leaves visible selections, existing carets and outside selections unchanged", () => {
    for (const f of [fixture("text"), fixture("", true), fixture("\u200b", false, false)]) {
        const before = {...f.range};
        f.exports.handleTouchUp();
        assert.equal(f.blurCount(), 0);
        assert.equal(f.selection.rangeCount, 1);
        assert.deepEqual(f.range, before);
        assert.equal(f.mobile.touchRange, undefined);
    }
});

test("long pressing editor padding restores the caret after native WebView focus loss", () => {
    const f = fixture("", true);
    f.startBlankTouch();
    f.document.activeElement = f.document.body;
    f.selection.removeAllRanges();
    assert.equal(f.contextMenu().defaultPrevented, true);
    assert.equal(f.document.activeElement, f.editable);
    assert.equal(f.focusCount(), 1);
    assert.equal(f.selection.rangeCount, 1);
    assert.equal(f.selection.getRangeAt().startContainer, f.range.startContainer);
    assert.equal(f.selection.getRangeAt().startOffset, f.range.startOffset);
    assert.equal(f.mobile.touchRange.collapsed, true);
    assert.equal(f.contextMenu().defaultPrevented, false);
});

test("blank-touch recovery leaves text gestures, multiple fingers and hidden keyboards alone", () => {
    for (const kind of ["text", "multiple", "hidden", "outside"]) {
        const f = fixture("", true, kind !== "outside");
        if (kind === "hidden") f.hideKeyboard();
        f.startBlankTouch(kind === "text" ? {...f.element} : f.element, kind === "multiple" ? 2 : 1);
        f.document.activeElement = f.document.body;
        assert.equal(f.contextMenu().defaultPrevented, false, kind);
        assert.equal(f.focusCount(), 0, kind);
    }
});

test("blank-touch recovery expires on release or cancellation and does not steal another input's focus", () => {
    for (const kind of ["release", "cancel", "detached", "newInput", "otherTarget", "newEditor"]) {
        const f = fixture("", true);
        f.startBlankTouch();
        f.document.activeElement = f.document.body;
        if (kind === "release") f.exports.handleTouchUp();
        if (kind === "cancel") f.exports.handleTouchCancel();
        if (kind === "detached") f.range.startContainer.isConnected = false;
        if (kind === "newInput") f.document.activeElement = {};
        if (kind === "newEditor") f.editor.protyle.wysiwyg.element = {...f.element};
        assert.equal(f.contextMenu(kind === "otherTarget" ? {...f.element} : f.element).defaultPrevented, false, kind);
        assert.equal(f.focusCount(), 0, kind);
    }
});
