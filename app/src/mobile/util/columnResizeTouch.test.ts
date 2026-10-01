import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as gestures from "./touchPanelGesture";
import * as axes from "./touchGesture";
import * as bridgeCore from "../../util/touchDragBridgeCore";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const touchSource = compile("src/mobile/util/touch.ts");
const bridgeSource = compile("src/util/touchDragBridge.ts");

class TestElement {
    private classes: Set<string>;
    classList = {contains: (name: string) => this.classes.has(name), add: (name: string) => this.classes.add(name),
        remove: (name: string) => this.classes.delete(name)};
    tagName = "DIV";
    dataset: Record<string, string> = {};
    id = "";
    style = {transform: "", removeProperty() { this.transform = ""; }};
    scrollWidth = 300;
    clientWidth = 300;
    scrollLeft = 0;
    protected = false;
    onDispatch: (event: TestMouseEvent) => void = () => {};

    constructor(classes: string[] = [], public parentElement?: TestElement) {
        this.classes = new Set(classes);
    }
    closest(selector: string): TestElement | null {
        return selector.split(",").some(part => part.trim().startsWith(".") &&
            this.classList.contains(part.trim().slice(1))) ? this : this.parentElement?.closest(selector) || null;
    }
    getAttribute(name: string) {
        return name === "draggable" ? "false" : name === "data-type" ? this.dataset.type : null;
    }
    contains() { return false; }
    dispatchEvent(event: TestMouseEvent) { this.onDispatch(event); return !event.defaultPrevented; }
}

class TestMouseEvent {
    clientX: number;
    defaultPrevented = false;
    constructor(public type: string, properties = {}) { Object.assign(this, properties); }
    preventDefault() { this.defaultPrevented = true; }
}

const setup = (resize = true) => {
    let now = 1000;
    let width = 200;
    const actions: string[] = [];
    const handlers = new Map<string, Array<(event: any) => void>>();
    const block = new TestElement(["av"]);
    block.dataset.type = "NodeAttributeView";
    const scroll = new TestElement(["av__scroll"], block);
    const target = new TestElement(resize ? ["av__widthdrag"] : [], scroll);
    const child = new TestElement([], target);
    const left = new TestElement();
    const right = new TestElement();
    const mask = new TestElement(["fn__none"]);
    const keyboard = new TestElement(["fn__none"]);
    const selection = () => ({rangeCount: 0});
    const windowSelf = {innerWidth: 360, siyuan: {mobile: {}, zIndex: 0}, getSelection: selection,
        addEventListener() {}, setTimeout: () => 1, clearTimeout() {}};
    const documentSelf = {body: new TestElement(), documentElement: {addEventListener() {}},
        onmousemove: undefined as ((event: TestMouseEvent) => void) | undefined,
        onmouseup: undefined as (() => void) | undefined,
        querySelector: (selector: string) => selector === ".side-mask" ? mask : keyboard,
        querySelectorAll: (): Element[] => [], getElementById: (): null => null,
        elementFromPoint: () => target,
        addEventListener(type: string, listener: (event: any) => void) {
            handlers.set(type, [...handlers.get(type) || [], listener]);
        }};
    const dispatchResize = (event: TestMouseEvent) => {
        if (event.type === "mousedown") {
            actions.push("resize:start");
            const start = event.clientX;
            documentSelf.onmousemove = move => {
                width = 200 + move.clientX - start;
                actions.push("resize:move");
            };
            documentSelf.onmouseup = () => {
                actions.push("resize:end");
                documentSelf.onmousemove = undefined;
                documentSelf.onmouseup = undefined;
            };
            event.preventDefault();
        } else if (event.type === "mousemove") {
            documentSelf.onmousemove?.(event);
        }
    };
    target.onDispatch = dispatchResize;
    child.onDispatch = dispatchResize;
    const closestAttribute = (element: TestElement, name: string, value: string) => {
        while (element) {
            if (name === "data-prevent-swipe" && element.protected || name === "id" && element.id === value ||
                name === "data-type" && element.dataset.type === value) {
                return element;
            }
            element = element.parentElement;
        }
    };
    const modules: Record<string, unknown> = {
        "./sidebar": {
            getSidebarElement: (side: string) => side === "left" ? left : right,
            getSidebarDock: () => ({}),
            popSidebar: (side: string) => actions.push(`sidebar:open:${side}`),
            switchToNextSidebarTab: (side: string) => actions.push(`sidebar:next:${side}`),
        },
        "./touchPanelGesture": gestures, "./touchGesture": axes,
        "./mobileBarsConfig": {getMobileSidebarConfig: () => ({sidebarSwipe: true})},
        "../../protyle/util/hasClosest": {hasClosestByAttribute: closestAttribute,
            hasClosestByClassName: (element: TestElement, name: string) => element.closest("." + name),
            hasTopClosestByClassName: (element: TestElement, name: string) => element.closest("." + name),
            hasClosestBlock: (): undefined => undefined},
        "./closePanel": {closePanel: () => actions.push("sidebar:close"),
            showPanelMask: () => { actions.push("sidebar:mask"); mask.classList.remove("fn__none"); }},
        "./keyboardToolbar": {activeBlur() {}, resetAndroidBoundedSelectionGesture() {}},
        "../../protyle/util/compatibility": {isInHarmony: () => false, isInAndroid: () => false, isIPhone: () => false},
        "../editor": {getCurrentEditor: (): undefined => undefined},
        "../../constants": {Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500, TIMEOUT_MULTIPLE_SELECT: 500}},
    };
    const globals = {document: documentSelf, window: windowSelf, HTMLElement: TestElement, MouseEvent: TestMouseEvent,
        getSelection: selection, getComputedStyle: () => ({overflowX: "auto"}), Date: {now: () => now}, clearTimeout() {}};
    const touch: Record<string, (event: any) => void> = {};
    runInNewContext(touchSource, {exports: touch, require: (name: string) => modules[name] || {}, ...globals});
    // 与移动端启动顺序一致：侧栏先注册，调整列宽的触摸桥接随后注册。
    documentSelf.addEventListener("touchstart", touch.handleTouchStart);
    documentSelf.addEventListener("touchmove", touch.handleTouchMove);
    documentSelf.addEventListener("touchend", touch.handleTouchEnd);
    documentSelf.addEventListener("touchcancel", touch.handleTouchCancel);
    const bridge: {initTouchDragBridge?: () => void} = {};
    runInNewContext(bridgeSource, {exports: bridge,
        require: (name: string) => name === "./touchDragBridgeCore" ? bridgeCore : {
            Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500, TIMEOUT_MOUSE_DRAG_DELAY: 150},
            isInAndroid: () => false, ipcRenderer: {on() {}}, stopScrollAnimation() {},
        }, ...globals});
    bridge.initTouchDragBridge();
    const dispatch = (type: string, x: number, eventTarget = target) => {
        now += 50;
        const point = {target: eventTarget, clientX: x, clientY: 200, radiusX: 1};
        const event = {target: eventTarget, touches: [point], changedTouches: [point], defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}};
        handlers.get(type)?.forEach(listener => listener(event));
        return event;
    };
    return {actions, left, right, target, child, scroll, dispatch, width: () => width};
};

for (const x of [120, 240]) {
    test(`database width drag to ${x}px keeps both sidebars closed while the resize bridge runs`, () => {
        const fixture = setup();
        fixture.dispatch("touchstart", 180);
        assert.equal(fixture.dispatch("touchmove", x).defaultPrevented, true);
        fixture.dispatch("touchend", x);
        assert.deepEqual(fixture.actions, ["resize:start", "resize:move", "resize:end"]);
        assert.equal(fixture.width(), 200 + x - 180);
        assert.equal(fixture.left.style.transform, "");
        assert.equal(fixture.right.style.transform, "");
    });
}

test("nested targets and canceled column drags never hand their gesture to a sidebar", () => {
    const fixture = setup();
    fixture.dispatch("touchstart", 180, fixture.child);
    fixture.dispatch("touchmove", 240, fixture.child);
    fixture.dispatch("touchcancel", 240, fixture.child);
    fixture.dispatch("touchend", 240, fixture.child);
    assert.deepEqual(fixture.actions, ["resize:start", "resize:move", "resize:end"]);
});

test("a column drag remains exclusive when the database reaches a horizontal scroll boundary", () => {
    const fixture = setup();
    fixture.scroll.scrollWidth = 600;
    fixture.scroll.scrollLeft = 100;
    fixture.dispatch("touchstart", 180);
    fixture.dispatch("touchmove", 200);
    fixture.scroll.scrollLeft = 0;
    fixture.dispatch("touchmove", 240);
    fixture.dispatch("touchend", 240);
    assert.deepEqual(fixture.actions, ["resize:start", "resize:move", "resize:move", "resize:end"]);
});

test("ordinary database edge swipes still open a sidebar", () => {
    const fixture = setup(false);
    fixture.dispatch("touchstart", 180);
    fixture.dispatch("touchmove", 240);
    fixture.dispatch("touchend", 240);
    assert.deepEqual(fixture.actions, ["sidebar:mask", "sidebar:open:left"]);
});
