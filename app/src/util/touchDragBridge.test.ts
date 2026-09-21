import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as core from "./touchDragBridgeCore";

const compiled = transpileModule(readFileSync("src/util/touchDragBridge.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class TestElement {
    draggable = "false";
    events: string[] = [];
    classList = {contains: (name: string) => this.classes.includes(name)};

    constructor(private classes: string[] = [], public parentElement?: TestElement) {}

    closest(selector: string): TestElement | null {
        return this.classes.includes(selector.slice(1)) ? this : this.parentElement?.closest(selector) || null;
    }

    getAttribute(name: string) {
        return name === "draggable" ? this.draggable : null;
    }

    setAttribute(name: string, value: string) {
        if (name === "draggable") {
            this.draggable = value;
        }
    }

    dispatchEvent(event: {type: string}) {
        this.events.push(event.type);
        return true;
    }
}

class TestHTMLElement extends TestElement {}

const createBridge = (rowClass = "b3-menu__item", panelClass = "av__panel") => {
    let now = 1000;
    const listeners = new Map<string, Array<(event: object) => void>>();
    const body = new TestHTMLElement();
    const panel = new TestHTMLElement([panelClass], body);
    const row = new TestHTMLElement([rowClass], panel);
    row.draggable = "true";
    const label = new TestHTMLElement(["b3-menu__label"], row);
    // SVG 的 use 子节点不是 HTMLElement，触摸仍需定位到所在行和抓手。
    const handle = new TestElement(["fn__grab"], row);
    const handleIcon = new TestElement([], handle);
    const runtime = {touchDragActive: false, touchDragGhost: null as HTMLElement | null};
    const exports: {initTouchDragBridge?: () => void} = {};
    runInNewContext(compiled, {
        exports,
        require: (id: string) => id === "./touchDragBridgeCore" ? core : {
            Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150},
            isInAndroid: () => false,
            ipcRenderer: {on() {}},
            stopScrollAnimation() {},
        },
        Date: {now: () => now},
        HTMLElement: TestHTMLElement,
        DataTransfer: class {},
        DragEvent: class {
            constructor(public type: string) {}
        },
        window: {
            siyuan: runtime,
            addEventListener() {},
            setTimeout: () => 1,
            clearTimeout() {},
        },
        document: {
            body,
            documentElement: {addEventListener() {}},
            addEventListener: (type: string, listener: (event: object) => void) => {
                listeners.set(type, [...listeners.get(type) || [], listener]);
            },
            querySelectorAll: (): Element[] => [],
            elementFromPoint: () => row,
        },
    });
    exports.initTouchDragBridge();
    const dispatch = (type: string, target: TestElement, y = 100, elapsed = 0, mouse = false) => {
        now += elapsed;
        const point = {clientX: 80, clientY: y, radiusX: mouse ? 0 : 1};
        const event = {
            target,
            touches: [point],
            changedTouches: [point],
            defaultPrevented: false,
            pointerType: mouse ? "mouse" : "touch",
            preventDefault() { this.defaultPrevented = true; },
        };
        listeners.get(type)?.forEach(listener => listener(event));
        return event.defaultPrevented;
    };
    return {row, label, handleIcon, runtime, dispatch};
};

for (const offset of [-80, 80]) {
    test(`swiping database menu content by ${offset}px keeps native scrolling available`, () => {
        const bridge = createBridge();
        bridge.dispatch("touchstart", bridge.label);
        assert.equal(bridge.row.draggable, "false");
        assert.equal(bridge.dispatch("touchmove", bridge.label, 100 + offset, 50), false);
        assert.equal(bridge.dispatch("touchmove", bridge.label, 100 + offset * 2, 600), false);
        assert.equal(bridge.dispatch("touchend", bridge.label, 100 + offset * 2), false);
        assert.deepEqual(bridge.row.events, []);
        assert.equal(bridge.runtime.touchDragActive, false);
        assert.equal(bridge.row.draggable, "true");
    });
}

test("long pressing database menu content still allows sorting", () => {
    const bridge = createBridge();
    bridge.dispatch("touchstart", bridge.label);
    assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 500), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
    bridge.dispatch("touchend", bridge.label, 160);
    assert.ok(bridge.row.events.includes("drop"));
    assert.equal(bridge.row.events[bridge.row.events.length - 1], "dragend");
    assert.equal(bridge.row.draggable, "true");
    assert.equal(bridge.runtime.touchDragActive, false);
});

test("dragging the database menu handle starts sorting without a long press", () => {
    const bridge = createBridge();
    bridge.dispatch("touchstart", bridge.handleIcon);
    assert.equal(bridge.dispatch("touchmove", bridge.handleIcon, 140, 50), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
    bridge.dispatch("touchcancel", bridge.handleIcon);
    assert.deepEqual(bridge.row.events, ["dragstart", "dragend"]);
    assert.equal(bridge.row.draggable, "true");
    assert.equal(bridge.runtime.touchDragActive, false);
});

test("tapping database menu content does not suppress its click", () => {
    const bridge = createBridge();
    assert.equal(bridge.dispatch("touchstart", bridge.label), false);
    assert.equal(bridge.dispatch("touchmove", bridge.label, 102, 50), false);
    assert.equal(bridge.dispatch("touchend", bridge.label, 102), false);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.row.draggable, "true");
});

test("mouse-generated touches can still drag database menu content immediately", () => {
    const bridge = createBridge();
    bridge.dispatch("pointerdown", bridge.label, 100, 0, true);
    bridge.dispatch("touchstart", bridge.label, 100, 0, true);
    assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 50, true), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
});

for (const [rowClass, panelClass] of [
    ["b3-menu__item", "b3-menu"],
    ["b3-list-item", "av__template-list"],
    ["b3-list-item", "b3-list"],
]) {
    test(`${panelClass} content allows scrolling and its handle still sorts`, () => {
        const bridge = createBridge(rowClass, panelClass);
        bridge.dispatch("touchstart", bridge.label);
        assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 50), false);
        bridge.dispatch("touchcancel", bridge.label);
        assert.deepEqual(bridge.row.events, []);
        assert.equal(bridge.row.draggable, "true");

        bridge.dispatch("touchstart", bridge.handleIcon);
        assert.equal(bridge.dispatch("touchmove", bridge.handleIcon, 140, 50), true);
        assert.deepEqual(bridge.row.events, ["dragstart"]);
    });
}

test("standalone database option handles still drag immediately", () => {
    const bridge = createBridge();
    bridge.row.draggable = "false";
    const handle = new TestHTMLElement(["fn__grab"], bridge.row);
    handle.draggable = "true";
    const icon = new TestElement([], handle);
    bridge.dispatch("touchstart", icon);
    assert.equal(bridge.dispatch("touchmove", icon, 140, 50), true);
    assert.deepEqual(handle.events, ["dragstart"]);
});

for (const panelClass of ["sy__file", "sy__outline", "layout-tab-bar", "protyle-action"]) {
    test(`${panelClass} keeps its existing scroll and long-press behavior`, () => {
        const bridge = createBridge("item", panelClass);
        bridge.dispatch("touchstart", bridge.label);
        assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 50), false);
        bridge.dispatch("touchend", bridge.label, 140);
        assert.deepEqual(bridge.row.events, []);

        bridge.dispatch("touchstart", bridge.label);
        assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 500), true);
        assert.deepEqual(bridge.row.events, ["dragstart"]);
    });
}
