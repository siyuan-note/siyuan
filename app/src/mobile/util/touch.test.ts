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
    const startContainer = {};
    const endContainer = {};
    const range = {
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
        collapseToStart() {
            range.collapsed = true;
            range.endContainer = range.startContainer;
            range.endOffset = range.startOffset;
        },
    };
    const mobile: any = {};
    const editor = {protyle: {wysiwyg: {element: {contains: () => inside}}}};
    const modules: Record<string, unknown> = {
        "./sidebar": {getSidebarElement: (): null => null},
        "./touchPanelGesture": {setSidebarSwipeState: () => {}},
        "./keyboardToolbar": {
            resetAndroidBoundedSelectionGesture: () => {},
            activeBlur: () => blurCount++,
        },
        "../editor": {getCurrentEditor: () => editor},
        "../../constants": {Constants: {TIMEOUT_MULTIPLE_SELECT: 1500}},
        "./touchSelection": touchSelection,
        "../../protyle/util/inlineElementMarker": {stripSemanticMarkersFromRangeText: () => text},
    };
    runInNewContext(compiled, {
        exports,
        require: (name: string) => modules[name] || {},
        document: {querySelector: (): null => null},
        window: {getSelection: () => selection, siyuan: {mobile}},
    });
    return {exports, selection, range, mobile, blurCount: () => blurCount};
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
