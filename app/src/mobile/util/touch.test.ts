import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as touchSelection from "./touchSelection";
import * as touchGesture from "./touchGesture";

const compiled = transpileModule(readFileSync("src/mobile/util/touch.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (text = "\u200b\n", collapsed = false, inside = true) => {
    const exports: any = {};
    let blurCount = 0;
    let focusCount = 0;
    let keyboardHidden = false;
    let now = 1000;
    let blockTouch = false;
    let nativeMenu = false;
    let multiSelectCount = 0;
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
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
    const editor = {protyle: {wysiwyg: {element}, options: {render: {gutter: false}}, toolbar: {
        isMultiSelectMode: () => multiSelectCount > 0,
        showMultiSelectMode: () => multiSelectCount++,
    }}};
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
        "../../constants": {Constants: {TIMEOUT_MULTIPLE_SELECT: 1500, TIMEOUT_LONGPRESS: 460, SIZE_DRAG_THRESHOLD: 5}},
        "../../protyle/util/hasClosest": {hasClosestBlock: () => blockTouch ? element : null, hasClosestByAttribute: (): null => null,
            hasClosestByClassName: (): null => null},
        "../../protyle/util/compatibility": {isIPhone: () => false, isIOSDevice: () => nativeMenu,
            isInAndroid: () => false, isInHarmony: () => false},
        "../../protyle/wysiwyg/nativeTextMenu": {usesNativeTextMenu: () => nativeMenu},
        "../../protyle/util/selection": {getRangeByPoint: () => range},
        "./blockSelection": {getMobileBlockSelectionElement: (value: unknown) => value},
        "./touchGesture": touchGesture,
        "./touchSelection": touchSelection,
        "../../protyle/util/inlineElementMarker": {stripSemanticMarkersFromRangeText: () => text},
    };
    runInNewContext(compiled, {
        exports,
        require: (name: string) => modules[name] || {},
        document,
        Node: {ELEMENT_NODE: 1},
        Date: {now: () => now},
        clearTimeout: (id: number) => timers.delete(id),
        getSelection: () => selection,
        window: {innerWidth: 384, innerHeight: 808, getSelection: () => selection, siyuan: {mobile},
            setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }},
    });
    const startBlankTouch = (target = element, count = 1, timeStamp = now, clientX = 100, clientY = 100) => {
        document.activeElement = editable;
        exports.handleTouchStart({target, timeStamp, touches: Array.from({length: count}, () =>
            ({target, clientX, clientY}))});
    };
    const contextMenu = (target = element) => {
        const event = {target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
        exports.handleTouchContextMenu(event);
        return event;
    };
    return {exports, selection, range, mobile, document, editable, element, editor, startBlankTouch, contextMenu,
        startBlockTouch: (timeStamp = now, clientX = 100, clientY = 100) => {
            blockTouch = true;
            startBlankTouch(element, 1, timeStamp, clientX, clientY);
        },
        nativeMenu: () => { nativeMenu = true; },
        delay: (duration = 2000) => { now += duration; },
        flushTimers: () => { for (const callback of timers.values()) callback(); timers.clear(); },
        multiSelectCount: () => multiSelectCount,
        hideKeyboard: () => { keyboardHidden = true; }, focusCount: () => focusCount, blurCount: () => blurCount};
};

test("release cancels pending multi-select even when processing is delayed beyond the threshold", () => {
    const f = fixture("", true);
    f.startBlockTouch();
    f.delay();
    f.exports.handleTouchUp();
    f.flushTimers();
    assert.equal(f.multiSelectCount(), 0);
});

test("iOS repeated text taps cannot enter multi-select when the native gesture omits touchend", () => {
    for (const initiallyCollapsed of [true, false]) {
        const f = fixture("word", initiallyCollapsed);
        f.nativeMenu();
        f.hideKeyboard();
        f.startBlockTouch(1000);
        f.delay();
        f.startBlockTouch(1100);
        f.range.collapsed = true;
        f.flushTimers();
        assert.equal(f.multiSelectCount(), 0);
        f.startBlockTouch(1200);
        f.flushTimers();
        assert.equal(f.multiSelectCount(), 0);
    }
});

test("separate iOS text presses and other platforms retain long-press multi-select", () => {
    for (const kind of ["later", "elsewhere", "otherPlatform"]) {
        const f = fixture("", true);
        if (kind !== "otherPlatform") {
            f.nativeMenu();
            f.hideKeyboard();
        }
        f.startBlockTouch(1000);
        f.exports.handleTouchUp();
        f.startBlockTouch(kind === "later" ? 1500 : 1100, kind === "elsewhere" ? 140 : 100);
        f.flushTimers();
        assert.equal(f.multiSelectCount(), 1, kind);
    }
});

test("native text menus and visible text selections permanently cancel this press's multi-select", () => {
    for (const mode of ["menu", "selection", "cancel", "focusout"]) {
        const f = fixture("text", true);
        f.startBlockTouch();
        if (mode === "menu") {
            f.nativeMenu();
            f.contextMenu();
        } else if (mode === "selection") {
            f.range.collapsed = false;
            f.exports.handleTouchSelectionChange();
            f.range.collapsed = true;
        } else if (mode === "focusout") {
            f.exports.handleTouchFocusOut({target: f.editable});
        } else {
            f.exports.handleTouchCancel();
        }
        f.flushTimers();
        assert.equal(f.multiSelectCount(), 0, mode);
    }
});

test("an uninterrupted long press still enters block multi-select", () => {
    const f = fixture("", true);
    f.startBlockTouch();
    f.flushTimers();
    assert.equal(f.multiSelectCount(), 1);
    let consumed = false;
    f.exports.handleTouchEnd({target: f.element, timeStamp: 2000,
        changedTouches: [{clientX: 100, clientY: 100}],
        stopImmediatePropagation: () => {}, preventDefault: () => { consumed = true; }});
    assert.equal(consumed, true);
    assert.equal(f.multiSelectCount(), 1);
});

test("text input and native editing menus cancel block selection without changing the caret", () => {
    const f = fixture("word", true);
    f.startBlockTouch();
    const original = {...f.range};
    f.exports.handleTouchEditing();
    f.flushTimers();
    assert.equal(f.multiSelectCount(), 0);
    assert.equal(f.selection.rangeCount, 1);
    assert.equal(f.range.startContainer, original.startContainer);
    assert.equal(f.range.startOffset, original.startOffset);
    assert.equal(f.range.endOffset, original.endOffset);
    assert.equal(f.focusCount(), 0);
    assert.equal(f.blurCount(), 0);
});

test("releasing an iOS native text gesture leaves its editing menu and selection handles native", () => {
    const f = fixture("word", true);
    f.nativeMenu();
    f.startBlockTouch();
    f.exports.handleTouchEditing();
    f.flushTimers();
    let prevented = false;
    f.exports.handleTouchEnd({target: f.element, timeStamp: 3000,
        changedTouches: [{clientX: 100, clientY: 100}],
        stopImmediatePropagation: () => {}, preventDefault: () => { prevented = true; }});
    assert.equal(prevented, false);
    assert.equal(f.multiSelectCount(), 0);
});

test("iOS editing long presses retain the keyboard without waiting for a native menu callback", () => {
    const f = fixture("", true);
    f.nativeMenu();
    f.startBlockTouch();
    f.delay();
    f.flushTimers();
    assert.equal(f.multiSelectCount(), 0);
    let prevented = false;
    f.exports.handleTouchEnd({target: f.element, timeStamp: 3000,
        changedTouches: [{clientX: 100, clientY: 100}],
        stopImmediatePropagation: () => {}, preventDefault: () => { prevented = true; }});
    assert.equal(prevented, false);
    assert.equal(f.blurCount(), 0);
});

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
