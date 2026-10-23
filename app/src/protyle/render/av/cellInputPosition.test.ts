import * as assert from "node:assert/strict";
import * as capabilities from "./capabilities";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/dialog/anchoredInputPosition.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height,
});

const setup = (fitContent = false, mobile = false) => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    class TestWindow extends EventTarget {
        visualViewport = Object.assign(new EventTarget(), {offsetLeft: 0, offsetTop: 0, width: 360, height: 800});
        innerWidth = 360;
        innerHeight = 800;
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
    const input = Object.assign(new EventTarget(), {parentElement: mask, style: {} as Record<string, string>,
        value: "draft", scrollHeight: 400});
    const document = {body: {}, activeElement: input as unknown};
    const exports: {bindAnchoredInputPosition?: (input: unknown, anchor: () => unknown, content?: unknown,
        fitContent?: boolean) => () => void} = {};
    runInNewContext(compiled, {
        exports, window, document, MutationObserver: TestObserver, ResizeObserver: TestObserver,
        require: () => ({isMobile: () => mobile}),
    });
    const dispose = exports.bindAnchoredInputPosition(input, () => anchor, content, fitContent);
    const flush = () => {
        const pending = Array.from(frames.values());
        frames.clear();
        pending.forEach(callback => callback(0));
    };
    return {window, document, observers, mask, content, input, frames, dispose, flush,
        get anchor() {return anchor;}, set anchor(value) {anchor = value;}};
};

test("floating input fits its draft inside the visible viewport when the mobile keyboard opens", () => {
    const f = setup(true);
    assert.equal(f.input.style.width, "240px");
    assert.equal(f.input.style.height, "400px");
    assert.equal(f.input.style.top, "392px");
    f.window.visualViewport.height = 320;
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.height, "304px");
    assert.equal(f.input.style.top, "8px");
    Object.assign(f.window.visualViewport, {width: 180, height: 250, offsetLeft: 12, offsetTop: 150});
    f.mask.rect = rect(8, 120, 180, 250);
    f.window.visualViewport.dispatchEvent(new Event("scroll"));
    f.flush();
    assert.equal(f.input.style.width, "164px");
    assert.equal(f.input.style.left, "12px");
    assert.equal(f.input.style.top, "38px");
    assert.equal(f.input.style.height, "234px");
    f.input.scrollHeight = 60;
    f.input.dispatchEvent(new Event("input"));
    f.flush();
    assert.equal(f.input.style.height, "60px");
    assert.equal(f.input.value, "draft");
    f.dispose();
    f.input.dispatchEvent(new Event("input"));
    assert.equal(f.frames.size, 0);
});

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

test("focused mobile cell stays visible throughout keyboard viewport transitions", () => {
    const f = setup(false, true);
    f.anchor.rect = rect(55, 167, 141, 33);
    f.window.innerHeight = 476;
    for (const height of [145, 476]) {
        f.window.visualViewport.height = height;
        f.window.visualViewport.dispatchEvent(new Event("resize"));
        f.flush();
        assert.equal(f.input.style.visibility, "");
        assert.equal(f.input.style.height, "33px");
        assert.ok(parseFloat(f.input.style.top) + 33 <= height);
        assert.equal(f.input.value, "draft");
    }
    assert.equal(f.input.style.top, "167px");
    f.dispose();
});

test("focused mobile cell fits above the keyboard and restores manually requested dimensions", () => {
    const f = setup(false, true);
    f.input.style.width = "300px";
    f.input.style.height = "120px";
    Object.assign(f.window.visualViewport, {offsetLeft: 20, offsetTop: 100, width: 240, height: 80});
    f.mask.rect = rect(8, 120, 360, 800);
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.visibility, "");
    assert.equal(f.input.style.left, "12px");
    assert.equal(f.input.style.top, "-20px");
    assert.equal(f.input.style.width, "240px");
    assert.equal(f.input.style.height, "80px");
    f.observers[0].notify();
    f.flush();
    Object.assign(f.window.visualViewport, {offsetLeft: 0, offsetTop: 0, width: 360, height: 800});
    f.mask.rect = rect(0, 0, 360, 800);
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.width, "300px");
    assert.equal(f.input.style.height, "120px");
    assert.equal(f.input.style.top, "500px");
    // 失去焦点或锚点被移除时仍沿用裁剪/隐藏规则，不能保留失效的编辑入口。
    f.document.activeElement = f.document.body;
    f.anchor.rect = rect(40, 810, 220, 36);
    f.window.dispatchEvent(new Event("scroll"));
    f.flush();
    assert.equal(f.input.style.visibility, "hidden");
    f.document.activeElement = f.input;
    f.anchor.isConnected = false;
    f.observers[1].notify();
    f.flush();
    assert.equal(f.input.style.visibility, "hidden");
    f.dispose();
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
        bindAnchoredInputPosition: (_input: unknown, getter: () => unknown) => {getAnchor = getter;},
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

test("anchored input keeps a manually resized size while it follows the anchor", () => {
    const fixture = setup();
    assert.equal(fixture.input.style.width, "220px");
    // 模拟拖拽输入框右下角后浏览器写入的内联尺寸
    fixture.input.style.width = "300px";
    fixture.input.style.height = "120px";
    fixture.anchor.rect = rect(40, 280, 220, 36);
    fixture.window.dispatchEvent(new Event("scroll"));
    fixture.flush();
    assert.equal(fixture.input.style.width, "300px");
    assert.equal(fixture.input.style.height, "120px");
    assert.equal(fixture.input.style.top, "280px");
    fixture.dispose();

    const fit = setup(true);
    fit.input.style.width = "200px";
    fit.input.style.height = "90px";
    fit.input.dispatchEvent(new Event("input"));
    fit.flush();
    assert.equal(fit.input.style.width, "200px");
    assert.equal(fit.input.style.height, "90px");
    assert.equal(fit.input.style.top, "500px");
    fit.dispose();
});

test("resized cell input stays aligned while constrained and restores its requested dimensions", () => {
    const f = setup();
    f.flush();
    assert.ok(f.observers[0].targets.includes(f.input));
    f.input.style.width = "300px";
    f.input.style.height = "120px";
    f.observers[0].notify();
    f.flush();
    f.content.rect = rect(16, 90, 250, 450);
    f.observers[0].notify();
    f.flush();
    assert.equal(f.input.style.left, "40px");
    assert.equal(f.input.style.top, "500px");
    assert.equal(f.input.style.width, "226px");
    assert.equal(f.input.style.height, "40px");
    // 自身尺寸变化产生的后续通知不能覆盖用户设置。
    f.observers[0].notify();
    f.flush();
    f.content.rect = rect(16, 90, 328, 710);
    f.observers[0].notify();
    f.flush();
    assert.equal(f.input.style.width, "300px");
    assert.equal(f.input.style.height, "120px");
    assert.equal(f.input.value, "draft");
    f.dispose();
});

test("resizing one constrained dimension preserves the requested size on the other axis", () => {
    const f = setup();
    f.input.style.width = "300px";
    f.input.style.height = "120px";
    f.content.rect = rect(16, 90, 250, 450);
    f.observers[0].notify();
    f.flush();
    f.input.style.width = "180px";
    f.observers[0].notify();
    f.flush();
    f.content.rect = rect(16, 90, 328, 710);
    f.observers[0].notify();
    f.flush();
    assert.equal(f.input.style.width, "180px");
    assert.equal(f.input.style.height, "120px");
    f.content.rect = rect(16, 90, 160, 450);
    f.observers[0].notify();
    f.flush();
    f.input.style.height = "30px";
    f.observers[0].notify();
    f.flush();
    f.content.rect = rect(16, 90, 328, 710);
    f.observers[0].notify();
    f.flush();
    assert.equal(f.input.style.width, "180px");
    assert.equal(f.input.style.height, "30px");
    f.dispose();
});

test("cell input respects the mobile visual viewport even when the layout viewport stays large", () => {
    const f = setup();
    f.input.style.width = "300px";
    f.input.style.height = "120px";
    f.anchor.rect = rect(40, 280, 220, 36);
    Object.assign(f.window.visualViewport, {offsetLeft: 20, offsetTop: 100, width: 240, height: 220});
    f.mask.rect = rect(8, 120, 360, 800);
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.left, "32px");
    assert.equal(f.input.style.top, "160px");
    assert.equal(f.input.style.width, "220px");
    assert.equal(f.input.style.height, "40px");
    Object.assign(f.window.visualViewport, {offsetLeft: 0, offsetTop: 0, width: 360, height: 800});
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.width, "300px");
    assert.equal(f.input.style.height, "120px");
    f.dispose();
});

test("resized input hides with an offscreen cell and restores its size when the cell returns", () => {
    const f = setup();
    f.input.style.width = "300px";
    f.input.style.height = "120px";
    for (const position of [rect(40, 40, 220, 36), rect(40, 810, 220, 36),
        rect(-220, 500, 220, 36), rect(350, 500, 220, 36)]) {
        f.anchor.rect = position;
        f.window.dispatchEvent(new Event("scroll"));
        f.flush();
        assert.equal(f.input.style.visibility, "hidden");
    }
    f.anchor.rect = rect(40, 500, 220, 36);
    f.window.dispatchEvent(new Event("scroll"));
    f.flush();
    assert.equal(f.input.style.width, "300px");
    assert.equal(f.input.style.height, "120px");
    assert.equal(f.input.style.visibility, "");
    f.dispose();
});

test("a partially visible cell keeps its input within the editor without changing automatic sizing", () => {
    const f = setup();
    f.anchor.rect = rect(240, 70, 220, 36);
    f.window.dispatchEvent(new Event("scroll"));
    f.flush();
    assert.equal(f.input.style.left, "240px");
    assert.equal(f.input.style.top, "90px");
    assert.equal(f.input.style.width, "104px");
    assert.equal(f.input.style.height, "16px");
    f.anchor.rect = rect(40, 500, 240, 40);
    f.window.dispatchEvent(new Event("scroll"));
    f.flush();
    assert.equal(f.input.style.width, "240px");
    assert.equal(f.input.style.height, "40px");
    f.dispose();
});

test("floating inputs also restore manually requested dimensions after a viewport constraint", () => {
    const f = setup(true);
    f.input.style.width = "300px";
    f.input.style.height = "200px";
    Object.assign(f.window.visualViewport, {width: 180, height: 150});
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.width, "164px");
    assert.equal(f.input.style.height, "134px");
    assert.equal(f.input.style.left, "8px");
    assert.equal(f.input.style.top, "8px");
    Object.assign(f.window.visualViewport, {width: 360, height: 800});
    f.window.visualViewport.dispatchEvent(new Event("resize"));
    f.flush();
    assert.equal(f.input.style.width, "300px");
    assert.equal(f.input.style.height, "200px");
    f.dispose();
});
