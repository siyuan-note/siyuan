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
    isConnected = true;
    tagName = "SPAN";
    dataset: Record<string, string> = {};
    events: string[] = [];
    classList = {contains: (name: string) => this.classes.includes(name), toggle: (name: string, active: boolean) => {
        this.classes = this.classes.filter(value => value !== name);
        if (active) {
            this.classes.push(name);
        }
    }};

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

    setPointerCapture() {}
}

class TestHTMLElement extends TestElement {}

const createBridge = (rowClass = "b3-menu__item", panelClass = "av__panel", mobile = false) => {
    let now = 1000;
    let hidden = false;
    let nextTimer = 0;
    const timers = new Map<number, {callback: () => void, time: number}>();
    const listeners = new Map<string, Array<(event: object) => void>>();
    const body = new TestHTMLElement();
    const panel = new TestHTMLElement([panelClass], body);
    const button = panelClass === "protyle-gutters" ? new TestHTMLElement([], panel) : panel;
    if (panelClass === "protyle-gutters") {
        button.tagName = "BUTTON";
    }
    const row = new TestHTMLElement([rowClass], button);
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
            isMobile: () => mobile,
            ipcRenderer: {on() {}},
            stopScrollAnimation() {},
        },
        Date: {now: () => now},
        Element: TestElement,
        HTMLElement: TestHTMLElement,
        DataTransfer: class { types: string[] = []; },
        DragEvent: class {
            constructor(public type: string) {}
        },
        window: {
            siyuan: runtime,
            addEventListener: (type: string, listener: (event: object) => void) => {
                listeners.set(type, [...listeners.get(type) || [], listener]);
            },
            setTimeout: (callback: () => void, delay = 0) => {
                timers.set(++nextTimer, {callback, time: now + delay});
                return nextTimer;
            },
            clearTimeout: (id: number) => timers.delete(id),
        },
        document: {
            body,
            get hidden() { return hidden; },
            documentElement: {addEventListener() {}},
            addEventListener: (type: string, listener: (event: object) => void) => {
                listeners.set(type, [...listeners.get(type) || [], listener]);
            },
            querySelectorAll: (): Element[] => [],
            elementFromPoint: () => row,
        },
    });
    exports.initTouchDragBridge();
    const advance = (elapsed: number) => {
        const end = now + elapsed;
        while (true) {
            const due = Array.from(timers).filter(([, timer]) => timer.time <= end)
                .sort((a, b) => a[1].time - b[1].time)[0];
            if (!due) {
                break;
            }
            timers.delete(due[0]);
            now = due[1].time;
            due[1].callback();
        }
        now = end;
    };
    const dispatch = (type: string, target: TestElement, y = 100, elapsed = 0, mouse = false, touchCount = 1) => {
        advance(elapsed);
        if (type === "visibilitychange") {
            hidden = true;
        }
        const point = {identifier: 1, clientX: 80, clientY: y, radiusX: mouse ? 0 : 1};
        const event = {
            ...point,
            target,
            touches: type === "touchend" || type === "touchcancel" ? [] :
                Array.from({length: touchCount}, (_, index) => ({...point, identifier: index + 1})),
            changedTouches: [point],
            defaultPrevented: false,
            pointerType: mouse ? "mouse" : "touch",
            button: 0,
            buttons: 1,
            pointerId: 1,
            preventDefault() { this.defaultPrevented = true; },
        };
        listeners.get(type)?.forEach(listener => listener(event));
        return event.defaultPrevented;
    };
    return {row, label, handleIcon, runtime, dispatch, advance};
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

test("a mobile block gutter activates dragging while the finger remains still", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    bridge.advance(459);
    assert.deepEqual(bridge.row.events, []);
    bridge.advance(1);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
    assert.equal(bridge.runtime.touchDragActive, true);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 140), true);
    assert.equal(bridge.dispatch("touchend", bridge.row, 140), true);
    assert.ok(bridge.row.events.includes("drop"));
    assert.equal(bridge.row.events[bridge.row.events.length - 1], "dragend");
    assert.equal(bridge.runtime.touchDragActive, false);
    assert.equal(bridge.row.draggable, "true");
});

test("short tapping a mobile block gutter preserves its menu click", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    assert.equal(bridge.dispatch("touchstart", bridge.row), false);
    assert.equal(bridge.dispatch("touchend", bridge.row, 102, 100), false);
    bridge.advance(500);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.row.draggable, "true");
});

test("moving a mobile block gutter before the long press cancels activation", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 110, 100), false);
    bridge.advance(500);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 140), false);
    assert.equal(bridge.dispatch("touchend", bridge.row, 140), true);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.row.draggable, "true");
});

test("small finger movements keep the block gutter long press pending", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 102, 100), false);
    bridge.advance(360);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
    assert.equal(bridge.dispatch("touchend", bridge.row, 102), true);
    assert.deepEqual(bridge.row.events, ["dragstart", "dragend"]);
    assert.equal(bridge.row.draggable, "true");
});

for (const cancel of ["touchcancel", "blur", "visibilitychange", "additional touch"]) {
    for (const active of [false, true]) {
        test(`${cancel} cancels ${active ? "active" : "pending"} block gutter dragging`, () => {
            const bridge = createBridge("", "protyle-gutters", true);
            bridge.dispatch("touchstart", bridge.row);
            if (active) {
                bridge.advance(460);
            }
            bridge.dispatch(cancel === "additional touch" ? "touchstart" : cancel, bridge.row, 100, 0, false, 2);
            bridge.advance(500);
            assert.deepEqual(bridge.row.events, active ? ["dragstart", "dragend"] : []);
            assert.equal(bridge.runtime.touchDragActive, false);
            assert.equal(bridge.row.draggable, "true");
        });
    }
}

test("removing a block gutter cancels its pending long press", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    bridge.row.isConnected = false;
    bridge.advance(460);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.runtime.touchDragActive, false);
    assert.equal(bridge.row.draggable, "true");
});

test("database row gutters still drag without the block long-press delay", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.row.parentElement.dataset.rowId = "row";
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 140, 50), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
});

test("desktop touch block gutters keep direct dragging", () => {
    const bridge = createBridge("", "protyle-gutters");
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 140, 50), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
});

test("mobile mouse block gutters keep direct dragging", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("pointerdown", bridge.row, 100, 0, true);
    assert.equal(bridge.dispatch("pointermove", bridge.row, 140, 50, true), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
});
