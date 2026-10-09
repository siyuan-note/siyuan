import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {bindBlockDragSelectionGesture} from "./blockDragSelectionGesture";

const compiled = transpileModule(readFileSync("src/protyle/wysiwyg/boundedBlockDragSelect.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (mobile = false) => {
    const exports: any = {};
    const classes = new Set<string>();
    let rootEditable = "false";
    let backlink = false;
    let multiSelect = false;
    let blockOwned = true;
    let selectionCleared = 0;
    let focused: unknown;
    let modeElement: unknown;
    let toolbarCount = 0;
    let gutterRestored = 0;
    let gutterTarget: unknown;
    const frames: FrameRequestCallback[] = [];
    const states = [new Set<string>(), new Set<string>()];
    const blocks = states.map((state, index) => ({
        classList: {add: (name: string) => state.add(name), remove: (name: string) => state.delete(name)},
        getAttribute: () => `block-${index}`,
        removeAttribute: () => {},
        contains: (other: unknown): boolean => other === blocks[index],
    }));
    const element = {
        classList: {contains: (name: string) => classes.has(name), add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name)},
        getAttribute: () => rootEditable,
        closest: () => backlink ? {} : null,
        contains: () => blockOwned,
        ownerDocument: {getSelection: () => ({removeAllRanges: () => selectionCleared++})},
        querySelectorAll: () => blocks.filter((_, i) => states[i].has("protyle-wysiwyg--select")),
    };
    const protyle: any = {
        gutter: {}, disabled: false,
        toolbar: {isMultiSelectMode: () => multiSelect, subElement: {},
            showMultiSelectMode: () => multiSelect = true},
    };
    let getScrollElement: Parameters<typeof bindBlockDragSelectionGesture>[1];
    let options: Parameters<typeof bindBlockDragSelectionGesture>[2];
    const modules: Record<string, unknown> = {
        "./blockDragSelectionGesture": {bindBlockDragSelectionGesture: (_element: unknown, scroll: typeof getScrollElement,
                                                                       value: typeof options) => {
            getScrollElement = scroll;
            options = value;
        }},
        "./blockSelection": {
            BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select",
            clearBlockSelectionMode: () => states.forEach(state => state.clear()),
            setBlockSelectionModeElement: (_element: unknown, block: unknown) => modeElement = block,
        },
        "./blockDragSelect": {getBlockDragSelectBlock: () => blocks[0]},
        "./getBlock": {},
        "../util/hasClosest": {isInEmbedBlock: () => false},
        "../util/selection": {
            focusBlock: (block: unknown) => focused = block,
            getBlockRangeSelectElements: () => ({selectElements: blocks}),
        },
        "../ui/hideElements": {hideElements: () => {}},
        "../gutter/restore": {restoreGutterBySelection: (_protyle: unknown, block: unknown) => {
            gutterRestored++;
            gutterTarget = block;
        }},
        "../../util/functions": {isMobile: () => mobile},
        "../../layout/status": {countBlockWord: () => {}},
        "../../mobile/util/multiSelectToolbar": {updateMultiSelectToolbar: (_element: unknown, count: number) => toolbarCount = count},
    };
    runInNewContext(compiled, {exports, require: (name: string) => modules[name], window: {siyuan: {}},
        requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback)});
    // 构造 WYSIWYG 时实例尚未赋给 protyle，绑定阶段不能从 protyle 读取编辑器元素。
    exports.bindBoundedBlockDragSelect(protyle, element);
    protyle.wysiwyg = {element};
    protyle.contentElement = {getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 100})};
    const target = (excluded = false, editable = true, ownEditor = true) => ({
        closest: (selector: string) => {
            if (selector === ".protyle-wysiwyg") {
                return ownEditor ? element : {};
            }
            if (selector === '[contenteditable="true"]' || selector === "[contenteditable]") {
                return {getAttribute: () => editable ? "true" : "false"};
            }
            return excluded ? {} : null;
        },
    } as unknown as HTMLElement);
    return {
        options: options!, getScrollElement: getScrollElement!, protyle, blocks: blocks as unknown as HTMLElement[], classes, states, target,
        setEditable: (value: string) => rootEditable = value,
        setBacklink: () => backlink = true,
        detach: () => blockOwned = false,
        enterMultiSelect: () => multiSelect = true,
        flushFrames: () => frames.splice(0).forEach(callback => callback(0)),
        state: () => ({focused, modeElement, multiSelect, selectionCleared, toolbarCount, gutterRestored, gutterTarget}),
    };
};

test("bounded selection resolves the scroll container after editor initialization on both platforms", () => {
    for (const mobile of [false, true]) {
        const f = fixture(mobile);
        assert.equal(f.getScrollElement(), f.protyle.contentElement);
    }
});

test("bounded mouse selection is enabled only for protected editor roots with block operations", () => {
    const f = fixture();
    assert.equal(f.options.canStart("mouse"), true);
    f.setEditable("true");
    assert.equal(f.options.canStart("mouse"), false);
    assert.equal(f.options.canStart("touch"), true);
    f.setEditable("false");
    f.classes.add("fn__pointer-none");
    assert.equal(f.options.canStart("mouse"), false, "padding drag retains ownership of its gesture");
    f.classes.clear();
    f.protyle.disabled = true;
    assert.equal(f.options.canStart("touch"), false);
    f.protyle.disabled = false;
    f.setBacklink();
    assert.equal(f.options.canStart("mouse"), false);
});

test("bounded selection starts in editable block content and leaves controls and nested editors alone", () => {
    const f = fixture();
    assert.equal(f.options.getStartBlock(f.target(), "mouse"), f.blocks[0]);
    assert.equal(f.options.getStartBlock(f.target(true), "mouse"), undefined);
    assert.equal(f.options.getStartBlock(f.target(false, false), "mouse"), undefined);
    assert.equal(f.options.getStartBlock(f.target(false, true, false), "mouse"), undefined);
    f.enterMultiSelect();
    assert.equal(f.options.getStartBlock(f.target(false, false), "touch"), f.blocks[0]);
});

test("desktop completion uses existing block selection and a focusable block without reopening the editor root", () => {
    const f = fixture();
    f.options.select(f.blocks[0], f.blocks[1], "mouse");
    assert.ok(f.states.every(state => state.has("protyle-wysiwyg--select")));
    assert.equal(f.state().selectionCleared, 1);
    assert.ok(f.classes.has("protyle-wysiwyg--hiderange"));
    f.options.finish("mouse", false);
    assert.equal(f.state().focused, f.blocks[1]);
    assert.equal(f.state().modeElement, f.blocks[1]);
    assert.equal(f.classes.has("protyle-wysiwyg--hiderange"), false);
    assert.equal(f.options.canStart("mouse"), true);
    assert.equal(f.state().gutterRestored, 0);
    f.flushFrames();
    assert.equal(f.state().gutterRestored, 1);
    assert.equal(f.state().gutterTarget, f.blocks[1]);
});

test("mobile completion retains the multi-select toolbar and cancellation does not steal focus", () => {
    const f = fixture(true);
    f.options.select(f.blocks[0], f.blocks[1], "touch");
    f.options.finish("touch", false);
    assert.equal(f.state().multiSelect, true);
    assert.equal(f.state().focused, undefined);
    f.options.select(f.blocks[0], f.blocks[1], "touch");
    assert.equal(f.state().toolbarCount, 2);
    f.options.finish("touch", true);
    f.flushFrames();
    assert.equal(f.state().gutterRestored, 0, "mobile keeps its multi-select toolbar");
    assert.equal(f.classes.has("protyle-wysiwyg--hiderange"), false);
    const removed = fixture();
    removed.options.select(removed.blocks[0], removed.blocks[1], "mouse");
    removed.detach();
    removed.options.finish("mouse", false);
    removed.flushFrames();
    assert.equal(removed.state().gutterRestored, 0);
    assert.equal(removed.state().focused, undefined);
});

test("cancelled bounded selection does not restore a gutter after losing focus", () => {
    const f = fixture();
    f.options.select(f.blocks[0], f.blocks[1], "touch");
    f.options.finish("touch", true);
    f.flushFrames();
    assert.equal(f.state().gutterRestored, 0);
});
