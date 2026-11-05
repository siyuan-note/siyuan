import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const scrollCode = compile(readFileSync("src/boot/globalEvent/dragover.ts", "utf8"));
const columnCode = compile(readFileSync("src/boot/globalEvent/avColumnDragScroll.ts", "utf8"));
const eventSource = createSourceFile("event.ts", readFileSync("src/boot/globalEvent/event.ts", "utf8"), ScriptTarget.Latest, true);
const eventBindings: string[] = [];
const visit = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(eventSource) === "window.addEventListener" &&
        ['"dragover"', '"drop"', '"dragend"', '"dragleave"'].includes(node.arguments[0]?.getText(eventSource))) {
        eventBindings.push(node.getText(eventSource));
    }
    forEachChild(node, visit);
};
visit(eventSource);
const eventCode = compile(`let scrollTarget; const KANBAN_GROUP_DRAG_TYPE = "gutter-nodeattributeview|group|";
${eventBindings.join(";\n")};`);

const setup = () => {
    class Rect {
        constructor(public x: number, public y: number, public width: number, public height: number) {}
        get left() { return this.x; }
        get right() { return this.x + this.width; }
        get top() { return this.y; }
        get bottom() { return this.y + this.height; }
    }
    const frames = new Map<number, FrameRequestCallback>();
    let frameID = 0;
    const listeners = new Map<string, {callback: (event: unknown) => void, capture: boolean}>();
    const viewport = {getBoundingClientRect: () => new Rect(150, 50, 450, 300)};
    const scroll = {
        isConnected: true, scrollLeft: 200, scrollTop: 0, scrollWidth: 1400, clientWidth: 600,
        getBoundingClientRect: () => new Rect(100, 90, 600, 200),
        scroll({left}: {left: number}) { this.scrollLeft = Math.max(0, Math.min(left, this.scrollWidth - this.clientWidth)); },
    };
    const header = {
        isConnected: true,
        getBoundingClientRect: () => new Rect(-100, 100, 1400, 40),
        closest: (selector: string): unknown => selector === ".av__scroll" ? scroll :
            selector === ".protyle-content" ? viewport : null,
    };
    const source = {isConnected: true, closest: () => header};
    const target = {closest: (selector: string) => selector === ".av__row--header" ? header : null};
    const window = {innerWidth: 1000, innerHeight: 600, siyuan: {dragElement: source, dragTitle: ""},
        addEventListener: (name: string, callback: (event: unknown) => void, capture = false) => listeners.set(name, {callback, capture})};
    const Constants = {SIYUAN_DROP_GUTTER: "gutter-", ZWSP: "|", SIZE_SCROLL_TB: 32,
        SIYUAN_DROP_DOCUMENT_TAB: "document-tab", SIYUAN_DROP_BLOCK: "block", SIYUAN_DROP_TAB: "tab", SIYUAN_DROP_FILE: "file"};
    const scrollAPI = {} as typeof import("./dragover");
    runInNewContext(scrollCode, {exports: scrollAPI, require: () => ({Constants}),
        requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameID, callback); return frameID; },
        cancelAnimationFrame: (id: number) => frames.delete(id)});
    const columnAPI = {} as typeof import("./avColumnDragScroll");
    runInNewContext(columnCode, {exports: columnAPI, window, DOMRect: Rect,
        require: (id: string) => id.endsWith("constants") ? {Constants} : scrollAPI});
    runInNewContext(eventCode, {window, Constants, ...scrollAPI, ...columnAPI,
        hasClosestByClassName: (element: typeof target, className: string) => element.closest("." + className),
        isWindow: () => true, document: {querySelector: (): null => null},
        clearTabHoverSwitch() {}, hideDragTip() {}, clearDragTipGhost() {}});
    let timestamp = 100;
    const tick = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(timestamp));
        timestamp += 16;
    };
    const event = (x: number, y = 120, eventTarget: unknown = target, types = ["gutter-nodeattributeview|col|field"]) => ({
        clientX: x, clientY: y, target: eventTarget, dataTransfer: {types},
    });
    const drag = (x: number, y = 120, eventTarget: unknown = target, types?: string[]) =>
        listeners.get("dragover").callback(event(x, y, eventTarget, types));
    return {scroll, header, viewport, source, target, window, frames, listeners, event, drag, tick, columnAPI, scrollAPI};
};

test("database column dragging scrolls both visible horizontal edges and stops in the center", () => {
    const f = setup();
    f.drag(590);
    f.tick();
    assert.ok(f.scroll.scrollLeft > 200);
    const afterRight = f.scroll.scrollLeft;
    f.tick();
    assert.ok(f.scroll.scrollLeft > afterRight, "a stationary pointer continues to scroll");
    const beforeLeft = f.scroll.scrollLeft;
    f.drag(155);
    f.tick();
    assert.ok(f.scroll.scrollLeft < beforeLeft);
    f.drag(350);
    assert.equal(f.frames.size, 0);
    assert.equal(f.scroll.scrollTop, 0);
});

test("database column scrolling rejects another header, detached sources and nonoverflowing tables", () => {
    for (const invalidate of [
        (f: ReturnType<typeof setup>) => f.drag(590, 120, {closest: () => ({})}),
        (f: ReturnType<typeof setup>) => { f.source.isConnected = false; f.drag(590); },
        (f: ReturnType<typeof setup>) => { f.scroll.scrollWidth = f.scroll.clientWidth; f.drag(590); },
    ]) {
        const f = setup();
        f.drag(590);
        assert.equal(f.frames.size, 1);
        invalidate(f);
        assert.equal(f.frames.size, 0);
    }
});

test("database refresh stops column scrolling without requiring another drag event", () => {
    for (const removed of ["source", "header", "scroll"] as const) {
        const f = setup();
        f.drag(590);
        f.tick();
        const position = f.scroll.scrollLeft;
        f[removed].isConnected = false;
        f.tick();
        assert.equal(f.scroll.scrollLeft, position);
        assert.equal(f.frames.size, 0);
    }
});

test("another drag on the same scroller clears the previous column lifecycle guard", () => {
    const f = setup();
    f.drag(590);
    f.tick();
    const position = f.scroll.scrollLeft;
    f.scrollAPI.dragOverScroll({clientX: 690, clientY: 120}, f.scroll.getBoundingClientRect() as DOMRect, f.scroll as unknown as Element, "x");
    f.source.isConnected = false;
    f.tick();
    assert.ok(f.scroll.scrollLeft > position);
});

test("fixed database headers use the clipped viewport rather than their full column width", () => {
    const f = setup();
    f.drag(590, 120, f.target, ["text/plain", "gutter-nodeattributeview|col|field"]);
    f.tick();
    assert.ok(f.scroll.scrollLeft > 200, "column handling precedes the text/plain return");
    for (const [x, y] of [[650, 120], [130, 120], [590, 150], [590, 80]]) {
        f.drag(590);
        f.drag(x, y);
        assert.equal(f.frames.size, 0);
    }
    f.window.innerWidth = 500;
    f.drag(490);
    assert.equal(f.frames.size, 1);
    f.window.innerWidth = 140;
    f.drag(130);
    assert.equal(f.frames.size, 0);
});

test("database column scroll stops at drop capture, drag end and drag leave", () => {
    for (const name of ["drop", "dragend", "dragleave"]) {
        const f = setup();
        f.drag(590);
        assert.equal(f.frames.size, 1);
        f.listeners.get(name).callback({});
        assert.equal(f.frames.size, 0);
        if (name === "drop") assert.equal(f.listeners.get(name).capture, true);
    }
});

test("other drag types retain their existing global scrolling paths", () => {
    const f = setup();
    assert.equal(f.columnAPI.scrollDraggedAVColumn(f.event(590, 120, f.target, ["text/plain"]) as never), false);
    const kanban = {...f.scroll, getBoundingClientRect: () => ({left: 100, right: 700, top: 100, bottom: 400})};
    f.drag(690, 120, {closest: (selector: string) => selector === ".av__kanban" ? kanban : null}, ["gutter-nodeattributeview|group|group"]);
    f.tick();
    assert.ok(kanban.scrollLeft > 200);
    f.listeners.get("dragend").callback({});
    f.drag(590, 120, f.target, ["tab"]);
    assert.equal(f.frames.size, 0);
    const content = {scrollTop: 200, getBoundingClientRect: () => ({left: 100, right: 700, top: 100, bottom: 400}),
        scroll({top}: {top: number}) { this.scrollTop = top; }};
    const protyle = {classList: {contains: (name: string) => name === "protyle"}, querySelector: () => content};
    f.drag(400, 390, {closest: (selector: string) => selector === ".protyle" ? protyle : null}, ["block"]);
    f.tick();
    assert.ok(content.scrollTop > 200);
});
