import * as assert from "node:assert/strict";
import * as capabilities from "./capabilities";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/cellInputPosition.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

const setup = () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    class TestWindow extends EventTarget {
        visualViewport = new EventTarget();
        requestAnimationFrame(callback: FrameRequestCallback) {
            frames.set(++nextFrame, callback);
            return nextFrame;
        }
        cancelAnimationFrame(id: number) {
            frames.delete(id);
        }
    }
    const window = new TestWindow();
    const observers: TestObserver[] = [];
    class TestObserver {
        connected = true;
        targets: unknown[] = [];
        constructor(private callback: () => void) {
            observers.push(this);
        }
        observe(target: unknown) {
            this.targets.push(target);
        }
        unobserve(target: unknown) {
            this.targets = this.targets.filter(item => item !== target);
        }
        disconnect() {
            this.connected = false;
        }
        notify() {
            if (this.connected) {
                this.callback();
            }
        }
    }
    const mask = {isConnected: true, rect: rect(0, 0, 360, 800), getBoundingClientRect() {return this.rect;}};
    let anchor = {isConnected: true, rect: rect(40, 500, 220, 36), getBoundingClientRect() {return this.rect;}};
    const content = {rect: rect(16, 90, 328, 710), getBoundingClientRect() {return this.rect;}};
    const input = {parentElement: mask, style: {} as Record<string, string>, value: "draft"};
    const exports: {bindAVCellInputPosition?: (input: unknown, anchor: () => unknown, content?: unknown) => () => void} = {};
    runInNewContext(compiled, {
        exports, window, document: {body: {}}, MutationObserver: TestObserver, ResizeObserver: TestObserver,
    });
    const dispose = exports.bindAVCellInputPosition(input, () => anchor, content);
    const flush = () => {
        const pending = Array.from(frames.values());
        frames.clear();
        pending.forEach(callback => callback(0));
    };
    return {window, observers, mask, content, input, frames, dispose, flush,
        get anchor() {return anchor;}, set anchor(value) {anchor = value;}};
};

test("cell input follows native keyboard opening and closing without replacing the draft", () => {
    const fixture = setup();
    assert.equal(fixture.input.style.top, "500px");
    // 聚焦后页面上移，原生键盘改变布局视口。
    fixture.anchor.rect = rect(40, 280, 220, 36);
    fixture.content.rect = rect(16, 90, 328, 330);
    fixture.window.dispatchEvent(new Event("resize"));
    fixture.window.dispatchEvent(new Event("scroll"));
    assert.equal(fixture.frames.size, 1);
    fixture.flush();
    assert.equal(fixture.input.style.top, "280px");
    fixture.anchor.rect = rect(40, 500, 220, 36);
    fixture.content.rect = rect(16, 90, 328, 710);
    fixture.window.dispatchEvent(new Event("resize"));
    fixture.flush();
    assert.equal(fixture.input.style.top, "500px");
    assert.equal(fixture.input.value, "draft");
    fixture.dispose();
});

test("visual viewport changes keep the input aligned when the fixed mask origin moves", () => {
    const fixture = setup();
    fixture.flush();
    fixture.anchor.rect = rect(40, 300, 220, 36);
    fixture.mask.rect = rect(8, 120, 360, 400);
    fixture.window.visualViewport.dispatchEvent(new Event("resize"));
    fixture.flush();
    assert.equal(fixture.input.style.top, "180px");
    assert.equal(fixture.input.style.left, "32px");
    fixture.mask.rect = rect(8, 150, 360, 400);
    fixture.window.visualViewport.dispatchEvent(new Event("scroll"));
    fixture.flush();
    assert.equal(fixture.input.style.top, "150px");
    fixture.dispose();
});

test("desktop scrolling and narrow editor resizing preserve input width and bottom clipping", () => {
    const fixture = setup();
    fixture.flush();
    fixture.anchor.rect = rect(-60, 380, 400, 36);
    fixture.content.rect = rect(16, 90, 160, 310);
    fixture.window.dispatchEvent(new Event("scroll"));
    fixture.observers[0].notify();
    fixture.flush();
    assert.equal(fixture.input.style.left, "16px");
    assert.equal(fixture.input.style.width, "160px");
    assert.equal(fixture.input.style.height, "20px");
    fixture.anchor.rect = rect(40, 420, 220, 36);
    fixture.window.dispatchEvent(new Event("scroll"));
    fixture.flush();
    assert.equal(fixture.input.style.height, "0px");
    assert.equal(fixture.input.style.visibility, "hidden");
    fixture.dispose();
});

test("sticky header DOM changes update the anchor even when its dimensions stay the same", () => {
    const fixture = setup();
    fixture.flush();
    fixture.anchor.rect = rect(40, 460, 220, 36);
    fixture.observers[1].notify();
    fixture.flush();
    assert.equal(fixture.input.style.top, "460px");
    fixture.dispose();
});

test("detached anchors hide the input until its current cell is rebound", () => {
    const fixture = setup();
    fixture.flush();
    fixture.anchor.isConnected = false;
    const previousAnchor = fixture.anchor;
    fixture.observers[1].notify();
    fixture.flush();
    assert.equal(fixture.input.style.visibility, "hidden");
    fixture.anchor = {isConnected: true, rect: rect(40, 480, 220, 36), getBoundingClientRect() {return this.rect;}};
    fixture.observers[1].notify();
    fixture.flush();
    assert.equal(fixture.input.style.top, "480px");
    assert.equal(fixture.input.style.visibility, "");
    assert.equal(fixture.input.value, "draft");
    assert.ok(!fixture.observers[0].targets.includes(previousAnchor));
    assert.ok(fixture.observers[0].targets.includes(fixture.anchor));
    fixture.dispose();
});

test("removing the mask cancels pending positioning and releases observers and event listeners", () => {
    const fixture = setup();
    fixture.mask.isConnected = false;
    fixture.observers[1].notify();
    assert.equal(fixture.frames.size, 0);
    assert.ok(fixture.observers.every(observer => !observer.connected));
    fixture.window.dispatchEvent(new Event("scroll"));
    fixture.window.dispatchEvent(new Event("resize"));
    fixture.window.visualViewport.dispatchEvent(new Event("scroll"));
    fixture.window.visualViewport.dispatchEvent(new Event("resize"));
    assert.equal(fixture.frames.size, 0);
    fixture.dispose();
});

const cellSource = readFileSync("src/protyle/render/av/cell.ts", "utf8");
const popCompiled = transpileModule(cellSource.slice(cellSource.indexOf("export const popTextCell ="),
    cellSource.indexOf("const updateCellValueByInput =")), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const openInput = (positionByMenu = false) => {
    let getAnchor: () => unknown;
    let menuPositioned = false;
    let inserted = false;
    let selector = "";
    const input = Object.assign(new EventTarget(), {
        value: "", dataset: {}, select: () => {}, focus: () => {
            assert.ok(positionByMenu ? menuPositioned : getAnchor, "positioning must be bound before focus");
        },
    });
    const mask = Object.assign(new EventTarget(), {querySelector: () => input});
    const cell = {
        isConnected: true,
        dataset: {},
        getBoundingClientRect: () => rect(40, 500, 220, 36),
        matches: () => false,
        querySelector: (name: string) => name === ".av__celltext" ? {textContent: "draft"} : null,
        getAttribute: () => "column-id",
        closest: (name: string) => name.includes("av__body") ? {dataset: {groupId: "group-id"}} :
            {dataset: {id: "row-id"}, classList: {contains: () => true}},
    };
    const replacement = {...cell};
    const cells = [cell];
    const block = {
        isConnected: true,
        dataset: {nodeId: "block-id"},
        getAttribute: () => "table",
        querySelector: (value: string) => {
            selector = value;
            return replacement;
        },
    };
    const exports: {popTextCell?: (protyle: unknown, cells: unknown[], type: string, options: unknown) => void} = {};
    runInNewContext(popCompiled, {
        ...capabilities,
        exports, isTableLikeView: () => true, hasClosestBlock: () => block, hasClosestByClassName: (): null => null,
        getComputedStyle: () => ({}), getStoredCellValueByElement: (): undefined => undefined,
        escapeAttr: (value: string) => value,
        AV_CELL_EDITOR_CLOSE_EVENT: "close", callMobileAppShowKeyboard: () => {},
        window: {siyuan: {menus: {menu: {remove: () => {}}}, zIndex: 0}},
        document: {querySelector: () => inserted ? mask : null, body: {insertAdjacentHTML: () => {inserted = true;}}},
        bindAVCellInputPosition: (_input: unknown, getter: () => unknown) => {getAnchor = getter;},
        setPosition: () => {menuPositioned = true;},
    });
    exports.popTextCell({}, cells, "block", {scrollIntoView: false, positionByMenu});
    return {cell, cells, replacement, input, getAnchor, menuPositioned, getSelector: () => selector};
};

test("opening a primary cell binds positioning before focus and retains its group identity after redraw", () => {
    const fixture = openInput();
    assert.equal(fixture.input.value, "draft");
    fixture.cell.isConnected = false;
    assert.equal(fixture.getAnchor(), fixture.replacement);
    assert.equal(fixture.cells[0], fixture.replacement);
    assert.equal(fixture.getSelector(),
        '.av__body[data-group-id="group-id"] .av__row[data-id="row-id"] .av__cell[data-col-id="column-id"]');
    assert.equal(fixture.input.value, "draft");
});

test("batch inputs opened below a menu keep menu positioning instead of cell tracking", () => {
    const fixture = openInput(true);
    assert.equal(fixture.menuPositioned, true);
    assert.equal(fixture.getAnchor, undefined);
});
