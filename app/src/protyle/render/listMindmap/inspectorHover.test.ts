import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("view.ts", readFileSync("src/protyle/render/listMindmap/view.ts", "utf8"),
    ScriptTarget.ES2021, true);
const view = source.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
assert.ok(view && isClassDeclaration(view));
const names = ["bindInspectorPanelEvents", "inspectorPanelEnter", "inspectorPanelLeave", "queueInspectorPanelClose",
    "openInspectorPanel", "closeInspectorPanel", "renderInspector", "destroy"];
const methods = view.members.filter(item => item.name && names.includes(item.name.getText(source)));
assert.equal(methods.length, names.length);
const compiled = transpileModule(`class View { ${methods.map(item => item.getText(source)).join("\n")} }
globalThis.View = View;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

class Element extends EventTarget {
    children: Element[] = [];
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    classList = {add() {}, remove() {}, toggle() {}};
    hidden = false;
    disabled = false;
    contains(target: Element | null): boolean {
        return target === this || this.children.some(child => child.contains(target));
    }
    append(...children: Element[]) {
        this.children.push(...children);
    }
    replaceChildren(...children: Element[]) {
        this.children = children;
    }
    querySelector(selector: string) {
        return selector === "svg" ? new Element() : null;
    }
    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
}

const setup = () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const clearTimeout = (id: number) => timers.delete(id);
    const window = Object.assign(new Element(), {
        setTimeout: (callback: () => void, delay: number) => {
            assert.equal(delay, 200);
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
    });
    const outside = new Element();
    let hit: Element | null = outside;
    const document = {activeElement: outside, elementFromPoint: () => hit};
    const context: any = {window, document, Node: Element, clearTimeout, cancelAnimationFrame: () => {}};
    runInNewContext(compiled, context);
    const popover = new Element();
    popover.hidden = true;
    const disposers: (() => void)[] = [];
    let previews = 0;
    const target = Object.assign(new context.View(), {
        inspector: new Element(), inspectorPopover: popover, disposers,
        options: {host: new Element(), onNodeWidths: async () => true},
        selectedId: "node", model: {root: {id: "root"}}, positions: new Map(),
        buttons: new Map([["relation", new Element()], ["summary", new Element()]]),
        nodeElements: new Map(), relationElements: new Map(), summaryElements: new Map(),
        getSelectedIds: () => ["node"], nodeWidths: () => [{id: "node", width: 0}],
        queueInspectorLayout: () => {}, renderInspectorPanel: () => popover.hidden = false,
        previewNodeWidths: () => previews++, cancelPointer: () => {}, exitFullscreen: () => {},
        resizeObserver: {disconnect: () => {}},
        listen: (element: Element, type: string, action: EventListener) => {
            element.addEventListener(type, action);
            disposers.push(() => element.removeEventListener(type, action));
        },
        makeButton: (key: string, _icon: string, action: () => void) => {
            const button = new Element();
            button.setAttribute("aria-label", key);
            button.addEventListener("click", action);
            return button;
        },
    });
    target.bindInspectorPanelEvents();
    target.renderInspector();
    const button = (kind: string) => target.inspector.children.find((item: Element) =>
        item.attributes.get("aria-label") === kind) as Element;
    const dispatch = (element: Element, type: string, fields: Record<string, unknown> = {}) => {
        const event = new Event(type);
        Object.assign(event, {pointerType: "mouse", pointerId: 1, relatedTarget: outside,
            clientX: 1000, clientY: 1000}, fields);
        element.dispatchEvent(event);
    };
    const flush = () => {
        const callbacks = [...timers.values()];
        timers.clear();
        callbacks.forEach(callback => callback());
    };
    return {target, popover, window, document, outside, timers, button, dispatch, flush,
        hit: (element: Element | null) => hit = element, previews: () => previews};
};

test("mouse hover panels close after leaving either trigger, including the window boundary", () => {
    for (const kind of ["color", "width"]) {
        for (const outsideWindow of [false, true]) {
            const {target, popover, button, dispatch, timers, flush} = setup();
            dispatch(button(kind), "pointerenter");
            assert.equal(popover.hidden, false);
            assert.equal(button(kind).attributes.get("aria-expanded"), "true");
            dispatch(button(kind), "pointerleave", outsideWindow ? {relatedTarget: null} : {});
            assert.equal(popover.hidden, false, "the gap between the trigger and panel remains traversable");
            assert.equal(timers.size, 1);
            target.inspectorPanel.preview = true;
            flush();
            assert.equal(popover.hidden, true);
            assert.equal(target.inspectorPanel, undefined);
            assert.equal(button(kind).attributes.get("aria-expanded"), "false");
        }
    }
});

test("entering the panel or returning to its trigger cancels delayed closure", () => {
    const {popover, button, dispatch, timers, flush} = setup();
    dispatch(button("color"), "pointerenter");
    dispatch(button("color"), "pointerleave");
    dispatch(popover, "pointerenter");
    assert.equal(timers.size, 0);
    flush();
    assert.equal(popover.hidden, false);
    dispatch(popover, "pointerleave", {relatedTarget: button("color")});
    assert.equal(timers.size, 0, "direct transitions within the combined region do not close it");
    dispatch(popover, "pointerleave");
    dispatch(button("color"), "pointerenter");
    flush();
    assert.equal(popover.hidden, false);
    dispatch(button("color"), "pointerleave", {relatedTarget: popover});
    assert.equal(timers.size, 0);
    dispatch(popover, "pointerleave");
    flush();
    assert.equal(popover.hidden, true);
});

test("focused width inputs remain open and close after focus leaves an already departed panel", () => {
    const {popover, document, outside, button, dispatch, flush} = setup();
    const input = new Element();
    popover.append(input);
    dispatch(button("width"), "pointerenter");
    dispatch(button("width"), "pointerleave", {relatedTarget: input});
    document.activeElement = input;
    dispatch(popover, "focusin");
    dispatch(popover, "pointerleave");
    flush();
    assert.equal(popover.hidden, false);
    dispatch(popover, "focusout");
    document.activeElement = outside;
    flush();
    assert.equal(popover.hidden, true);
});

test("slider and palette drags survive departure and use the actual pointer release position", () => {
    for (const kind of ["width", "color"]) {
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
            const {popover, window, button, dispatch, timers, flush, hit, outside} = setup();
            dispatch(button(kind), "pointerenter");
            dispatch(popover, "pointerenter");
            dispatch(popover, "pointerdown");
            dispatch(popover, "pointerleave");
            assert.equal(timers.size, 0);
            flush();
            assert.equal(popover.hidden, false);
            hit(outside);
            dispatch(type === "lostpointercapture" ? popover : window, type);
            flush();
            assert.equal(popover.hidden, true);
        }
    }
    const {popover, window, button, dispatch, timers, hit} = setup();
    dispatch(button("width"), "pointerenter");
    dispatch(popover, "pointerdown");
    dispatch(popover, "pointerleave");
    hit(popover);
    dispatch(window, "pointerup");
    assert.equal(timers.size, 0, "releasing inside the panel keeps it usable");
});

test("touch, pen, click and keyboard opening retain explicit dismissal", () => {
    for (const pointerType of ["touch", "pen"]) {
        const {popover, button, dispatch, flush} = setup();
        dispatch(button("color"), "pointerenter", {pointerType});
        assert.equal(popover.hidden, true);
        dispatch(button("color"), "click", {pointerType});
        dispatch(button("color"), "pointerleave", {pointerType});
        flush();
        assert.equal(popover.hidden, false);
    }
    const {popover, button, dispatch, flush} = setup();
    dispatch(button("width"), "pointerenter");
    dispatch(button("width"), "click", {detail: 0});
    dispatch(button("width"), "pointerleave");
    dispatch(button("width"), "pointerenter");
    dispatch(button("width"), "pointerleave");
    flush();
    assert.equal(popover.hidden, false, "hover does not turn an explicitly opened panel into a transient panel");
});

test("switching, closing and destroying panels invalidate pending callbacks", () => {
    const {target, popover, window, button, dispatch, timers, flush, previews} = setup();
    dispatch(button("color"), "pointerenter");
    dispatch(button("color"), "pointerleave");
    const stale = [...timers.values()][0];
    dispatch(button("width"), "pointerenter");
    stale();
    assert.equal(target.inspectorPanel.kind, "width");
    assert.equal(popover.hidden, false);
    target.inspectorPanel.preview = true;
    dispatch(window, "blur");
    flush();
    assert.equal(popover.hidden, true);
    assert.equal(previews(), 1, "closing retains width-preview rollback");
    dispatch(button("color"), "pointerenter");
    dispatch(button("color"), "pointerleave");
    target.closeInspectorPanel();
    assert.equal(timers.size, 0);
    dispatch(button("color"), "pointerenter");
    dispatch(button("color"), "pointerleave");
    const destroyed = [...timers.values()][0];
    target.destroy();
    assert.equal(timers.size, 0);
    destroyed();
    dispatch(window, "blur");
    assert.equal(timers.size, 0, "destroy releases the panel's global listeners");
});
