import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as core from "./touchDragBridgeCore";
import * as gutterVisibility from "../protyle/ui/gutterVisibility";

const {parse} = require("ifdef-loader/preprocessor");
const source = readFileSync("src/util/touchDragBridge.ts", "utf8");
const compiled = (browser: boolean, mobile: boolean) => transpileModule(
    parse(source, {BROWSER: browser, MOBILE: mobile}, false, true), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;

class TestElement {
    draggable = "false";
    isConnected = true;
    tagName = "SPAN";
    dataset: Record<string, string> = {};
    events: string[] = [];
    dragEvents: DragEvent[] = [];
    pointerCaptures = new Set<number>();
    classList = {contains: (name: string) => this.classes.includes(name), toggle: (name: string, active: boolean) => {
        this.classes = this.classes.filter(value => value !== name);
        if (active) {
            this.classes.push(name);
        }
    }};

    constructor(private classes: string[] = [], public parentElement?: TestElement) {}

    closest(selector: string): TestElement | null {
        if (selector === ".protyle-gutters[data-scrollable='true']" &&
            this.classes.includes("protyle-gutters") && this.dataset.scrollable === "true") {
            return this;
        }
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

    dispatchEvent(event: DragEvent) {
        this.events.push(event.type);
        this.dragEvents.push(event);
        return true;
    }

    setPointerCapture(id: number) { this.pointerCaptures.add(id); }
    hasPointerCapture(id: number) { return this.pointerCaptures.has(id); }
    releasePointerCapture(id: number) { this.pointerCaptures.delete(id); }
}

class TestHTMLElement extends TestElement {}

const createBridge = (rowClass = "b3-menu__item", panelClass = "av__panel", mobile = false,
                      options: {browser?: boolean, container?: string, scrollable?: boolean} = {}) => {
    let now = 1000;
    let hidden = false;
    let nextTimer = 0;
    const timers = new Map<number, {callback: () => void, time: number}>();
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const listeners = new Map<string, Array<(event: object) => void>>();
    const body = new TestHTMLElement();
    const panel = new TestHTMLElement([panelClass], body);
    if (options.scrollable) {
        panel.dataset.scrollable = "true";
    }
    const button = panelClass === "protyle-gutters" ? new TestHTMLElement([], panel) : panel;
    if (panelClass === "protyle-gutters") {
        button.tagName = "BUTTON";
    }
    const row = new TestHTMLElement([rowClass], button);
    row.draggable = "true";
    let dropTarget: TestElement | null = row;
    const label = new TestHTMLElement(["b3-menu__label"], row);
    // SVG 的 use 子节点不是 HTMLElement，触摸仍需定位到所在行和抓手。
    const handle = new TestElement(["fn__grab"], row);
    const handleIcon = new TestElement([], handle);
    const runtime = {touchDragActive: false, touchDragGhost: null as HTMLElement | null};
    const selection = {rangeCount: 1, removeAllRanges() { this.rangeCount = 0; }};
    const exports: {initTouchDragBridge?: () => void} = {};
    runInNewContext(compiled(!!options.browser, mobile), {
        exports,
        require: (id: string) => id === "../protyle/ui/gutterVisibility" ? gutterVisibility :
            id === "./touchDragBridgeCore" ? core : {
            Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460, TIMEOUT_MOUSE_DRAG_DELAY: 150},
            isInAndroid: () => options.container === "android",
            isInHarmony: () => options.container === "harmony",
            isMobile: () => mobile,
            ipcRenderer: {on() {}},
            stopScrollAnimation() {},
        },
        Date: {now: () => now},
        Element: TestElement,
        HTMLElement: TestHTMLElement,
        DataTransfer: class { types: string[] = []; },
        DragEvent: class {
            constructor(public type: string, options: DragEventInit) { Object.assign(this, options); }
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
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                frames.set(++nextFrame, callback);
                return nextFrame;
            },
            cancelAnimationFrame: (id: number) => frames.delete(id),
        },
        document: {
            body,
            get hidden() { return hidden; },
            documentElement: {
                addEventListener: (type: string, listener: (event: object) => void) => {
                    listeners.set(type, [...listeners.get(type) || [], listener]);
                },
            },
            addEventListener: (type: string, listener: (event: object) => void) => {
                listeners.set(type, [...listeners.get(type) || [], listener]);
            },
            querySelectorAll: (): Element[] => [],
            elementFromPoint: () => dropTarget,
            getSelection: () => selection,
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
    const dispatch = (type: string, target: TestElement, y = 100, elapsed = 0, mouse = false, touchCount = 1,
                      overrides: Partial<PointerEvent & KeyboardEvent> = {}) => {
        if (elapsed > 0) {
            advance(elapsed);
        }
        if (type === "visibilitychange") {
            hidden = true;
        }
        const point = {identifier: 1, clientX: 80, clientY: y, radiusX: mouse ? 0 : 1};
        const event = {
            ...point,
            type,
            target,
            touches: type === "touchend" || type === "touchcancel" ? [] :
                Array.from({length: touchCount}, (_, index) => ({...point, identifier: index + 1})),
            changedTouches: [point],
            defaultPrevented: false,
            pointerType: mouse ? "mouse" : "touch",
            button: 0,
            buttons: 1,
            pointerId: 1,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() {},
            ...overrides,
        };
        listeners.get(type)?.forEach(listener => listener(event));
        return event.defaultPrevented;
    };
    const flushFrames = () => {
        const callbacks = Array.from(frames.values());
        frames.clear();
        callbacks.forEach(callback => callback(now));
    };
    return {row, label, handleIcon, runtime, selection, dispatch, advance, flushFrames, gutter: panel,
        setDropTarget: (target: TestElement | null) => dropTarget = target};
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

test("mobile gutter protection covers the keyboard transition and ends with the gesture", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), true);
    bridge.advance(460);
    assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), true);
    bridge.dispatch("touchmove", bridge.row, 140);
    bridge.dispatch("touchend", bridge.row, 140);
    assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), false);
});

test("short tapping a mobile block gutter preserves its menu click", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    assert.equal(bridge.dispatch("touchstart", bridge.row), false);
    assert.equal(bridge.dispatch("touchend", bridge.row, 102, 100), false);
    assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), false);
    bridge.advance(500);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.row.draggable, "true");
});

test("moving a mobile block gutter before the long press cancels activation", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 110, 100), false);
    assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), false);
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

test("mobile block gutter dragging excludes native text selection until completion", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    assert.equal(bridge.dispatch("selectstart", bridge.label), false);
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("selectstart", bridge.label), true);
    assert.equal(bridge.selection.rangeCount, 1, "keep the source range available until dragstart resolves the blocks");
    bridge.advance(460);
    assert.equal(bridge.selection.rangeCount, 0);
    assert.equal(bridge.dispatch("selectstart", bridge.label), true);
    bridge.selection.rangeCount = 1;
    bridge.dispatch("selectionchange", bridge.label);
    assert.equal(bridge.selection.rangeCount, 0, "native handles cannot recreate a text range during block dragging");
    bridge.dispatch("touchmove", bridge.row, 140);
    bridge.dispatch("touchend", bridge.row, 140);
    assert.equal(bridge.dispatch("selectstart", bridge.label), false);
    bridge.selection.rangeCount = 1;
    bridge.dispatch("selectionchange", bridge.label);
    assert.equal(bridge.selection.rangeCount, 1);
});

test("canceling a pending mobile block gutter gesture restores native selection", () => {
    const bridge = createBridge("", "protyle-gutters", true, {scrollable: true});
    bridge.dispatch("touchstart", bridge.row);
    assert.equal(bridge.dispatch("selectstart", bridge.label), true);
    assert.equal(bridge.dispatch("touchmove", bridge.row, 140, 50), false);
    assert.equal(bridge.dispatch("selectstart", bridge.label), false);
    assert.equal(bridge.selection.rangeCount, 1);
    bridge.dispatch("touchcancel", bridge.row);
    assert.equal(bridge.dispatch("selectstart", bridge.label), false);
});

for (const mobile of [false, true]) {
    test(`other drag sources preserve native text selection (mobile=${mobile})`, () => {
        const bridge = createBridge("b3-list-item", "sy__file", mobile);
        bridge.dispatch("touchstart", bridge.label);
        bridge.dispatch("touchmove", bridge.label, 140, 500);
        assert.equal(bridge.dispatch("selectstart", bridge.label), false);
        assert.equal(bridge.selection.rangeCount, 1);
    });
}

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
            assert.equal(gutterVisibility.isGutterTouchDragging(bridge.gutter as unknown as HTMLElement), false);
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

for (const mobile of [false, true]) {
    test(`scrollable full gutters preserve swiping and long-press dragging (mobile=${mobile})`, () => {
        const bridge = createBridge("", "protyle-gutters", mobile, {scrollable: true});
        bridge.dispatch("touchstart", bridge.row);
        assert.equal(bridge.dispatch("touchmove", bridge.row, 140, 50), false);
        bridge.advance(500);
        assert.deepEqual(bridge.row.events, []);
        bridge.dispatch("touchend", bridge.row, 140);
        bridge.dispatch("touchstart", bridge.row);
        bridge.advance(500);
        assert.equal(bridge.dispatch("touchmove", bridge.row, 140), true);
        assert.equal(bridge.row.events.filter(type => type === "dragstart").length, 1);
    });
}

test("mobile mouse block gutters keep direct dragging", () => {
    const bridge = createBridge("", "protyle-gutters", true);
    bridge.dispatch("pointerdown", bridge.row, 100, 0, true);
    assert.equal(bridge.dispatch("pointermove", bridge.row, 140, 50, true), true);
    assert.deepEqual(bridge.row.events, ["dragstart"]);
});

for (const container of ["harmony", "android", "std", "ios"]) {
    test(`${container} browser build selects its mouse drag path`, () => {
        const bridge = createBridge("b3-list-item", "sy__file", false, {browser: true, container});
        bridge.row.dataset.type = "navigation-file";
        bridge.dispatch("pointerdown", bridge.label, 100, 0, true);
        const bridged = container === "harmony" || container === "android";
        assert.equal(bridge.row.draggable, bridged ? "false" : "true");
        bridge.dispatch("pointermove", bridge.label, 140, 500, true);
        assert.equal(bridge.runtime.touchDragActive, bridged);
        bridge.dispatch("pointercancel", bridge.label, 140, 0, true);
        assert.equal(bridge.row.draggable, "true");
    });
}

const createHarmonyPointerBridge = (gutter = false, mobile = false) => {
    const bridge = createBridge(gutter ? "" : "b3-list-item", gutter ? "protyle-gutters" : "sy__file",
        mobile, {browser: true, container: "harmony"});
    bridge.row.dataset.type = "navigation-file";
    return {
        ...bridge,
        pointer: (type: string, altKey: boolean, y = 100, overrides: Partial<PointerEvent & KeyboardEvent> = {}) =>
            bridge.dispatch(type, bridge.label, y, 0, true, 1, {altKey, ...overrides}),
    };
};

for (const [name, gutter, mobile] of [
    ["document tree", false, false],
    ["desktop block gutter", true, false],
    ["mobile block gutter", true, true],
] as const) {
    for (const [startAlt, endAlt] of [[true, true], [true, false], [false, true], [false, false]]) {
        test(`Harmony ${name} keeps live Alt ${startAlt} to ${endAlt} through drop`, () => {
            const bridge = createHarmonyPointerBridge(gutter, mobile);
            bridge.pointer("pointerdown", startAlt);
            bridge.pointer("pointermove", startAlt, 140);
            assert.equal(bridge.row.dragEvents[0].type, "dragstart");
            assert.equal(bridge.row.dragEvents[0].altKey, startAlt);
            assert.equal(bridge.runtime.touchDragActive, true);

            // 鼠标静止时也要根据按键变化刷新拖拽提示和落点。
            bridge.pointer(endAlt ? "keydown" : "keyup", endAlt, 140, {key: "Alt"});
            bridge.flushFrames();
            const overs = bridge.row.dragEvents.filter(event => event.type === "dragover");
            assert.equal(overs[overs.length - 1].altKey, endAlt);
            bridge.pointer("pointerup", endAlt, 160);
            bridge.pointer("pointerup", endAlt, 160);
            const drops = bridge.row.dragEvents.filter(event => event.type === "drop");
            assert.equal(drops.length, 1);
            assert.equal(drops[0].altKey, endAlt);
            assert.equal(bridge.row.dragEvents.filter(event => event.type === "dragend").length, 1);
            assert.equal(drops[0].dataTransfer, bridge.row.dragEvents[0].dataTransfer);
            assert.equal(bridge.row.draggable, "true");
            assert.equal(bridge.row.pointerCaptures.size, 0);
            assert.equal(bridge.runtime.touchDragActive, false);
            assert.equal(bridge.pointer("click", endAlt), true);
            assert.equal(bridge.pointer("click", endAlt), false);
        });
    }
}

test("Harmony pointerup uses the released Alt state even without another movement", () => {
    const bridge = createHarmonyPointerBridge();
    bridge.pointer("pointerdown", true);
    bridge.pointer("pointermove", true, 140);
    bridge.pointer("pointerup", false, 140);
    assert.equal(bridge.row.dragEvents.find(event => event.type === "drop").altKey, false);
});

for (const cancel of ["blur", "pointercancel", "lostpointercapture", "visibilitychange", "escape", "released buttons"]) {
    test(`Harmony ${cancel} cancels dragging and restores the next gesture`, () => {
        const bridge = createHarmonyPointerBridge();
        bridge.pointer("pointerdown", true);
        bridge.pointer("pointermove", true, 140);
        if (cancel === "escape") {
            bridge.pointer("keydown", true, 140, {key: "Escape"});
        } else if (cancel === "released buttons") {
            bridge.pointer("pointermove", true, 140, {buttons: 0});
        } else {
            bridge.pointer(cancel, true, 140);
        }
        bridge.flushFrames();
        bridge.pointer("pointerup", true, 140);
        assert.equal(bridge.row.events.includes("drop"), false);
        assert.equal(bridge.row.events.filter(type => type === "dragend").length, 1);
        assert.equal(bridge.row.draggable, "true");
        assert.equal(bridge.row.pointerCaptures.size, 0);
        assert.equal(bridge.runtime.touchDragActive, false);

        bridge.pointer("pointerdown", false);
        bridge.pointer("pointermove", false, 140);
        bridge.pointer("pointerup", false, 140);
        assert.equal(bridge.row.events.filter(type => type === "drop").length, 1);
    });
}

test("Harmony dragging outside a drop target cleans up without a drop", () => {
    const bridge = createHarmonyPointerBridge();
    bridge.pointer("pointerdown", true);
    bridge.pointer("pointermove", true, 140);
    bridge.setDropTarget(null);
    bridge.pointer("pointerup", true, 200);
    assert.equal(bridge.row.events.includes("drop"), false);
    assert.equal(bridge.row.draggable, "true");
    assert.equal(bridge.runtime.touchDragActive, false);
});

test("Harmony pending mouse gestures keep clicks and cancel on leaving the window", () => {
    const bridge = createHarmonyPointerBridge();
    bridge.pointer("pointerdown", false);
    bridge.pointer("pointerup", false, 102);
    assert.deepEqual(bridge.row.events, []);
    assert.equal(bridge.pointer("click", false), false);
    bridge.pointer("pointerdown", false);
    bridge.pointer("pointerleave", false);
    assert.equal(bridge.row.draggable, "true");
    assert.equal(bridge.runtime.touchDragActive, false);
});

test("Harmony only bridges internal document tree and ordinary block gutter mouse sources", () => {
    for (const [rowClass, panelClass] of [["b3-menu__item", "av__panel"], ["item", "layout-tab-bar"], ["", "protyle-gutters"]]) {
        const bridge = createBridge(rowClass, panelClass, false, {browser: true, container: "harmony"});
        if (panelClass === "protyle-gutters") {
            bridge.row.parentElement.dataset.rowId = "row";
        }
        bridge.dispatch("pointerdown", bridge.label, 100, 0, true);
        bridge.dispatch("pointermove", bridge.label, 140, 500, true);
        assert.equal(bridge.row.draggable, "true");
        assert.deepEqual(bridge.row.events, []);
    }
});

test("Harmony finger scrolling in the file tree preserves its long-press behavior", () => {
    const bridge = createBridge("b3-list-item", "sy__file", false, {browser: true, container: "harmony"});
    bridge.row.dataset.type = "navigation-file";
    bridge.dispatch("pointerdown", bridge.label);
    bridge.dispatch("touchstart", bridge.label);
    assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 50), false);
    bridge.dispatch("touchend", bridge.label, 140);
    assert.deepEqual(bridge.row.events, []);
    bridge.dispatch("touchstart", bridge.label);
    assert.equal(bridge.dispatch("touchmove", bridge.label, 140, 500), true);
    assert.equal(bridge.runtime.touchDragActive, true);
    bridge.dispatch("touchcancel", bridge.label);
    assert.equal(bridge.row.draggable, "true");
});
