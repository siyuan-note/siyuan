import {after, before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let topBarDrag: typeof import("./topBarDrag");
const originalVersion = Object.getOwnPropertyDescriptor(globalThis, "SIYUAN_VERSION");
const originalNodeEnv = Object.getOwnPropertyDescriptor(globalThis, "NODE_ENV");

before(async () => {
    Object.defineProperty(globalThis, "SIYUAN_VERSION", {configurable: true, value: "test"});
    Object.defineProperty(globalThis, "NODE_ENV", {configurable: true, value: "test"});
    topBarDrag = await import("./topBarDrag");
});

after(() => {
    if (originalVersion) {
        Object.defineProperty(globalThis, "SIYUAN_VERSION", originalVersion);
    } else {
        delete (globalThis as typeof globalThis & {SIYUAN_VERSION?: string}).SIYUAN_VERSION;
    }
    if (originalNodeEnv) {
        Object.defineProperty(globalThis, "NODE_ENV", originalNodeEnv);
    } else {
        delete (globalThis as typeof globalThis & {NODE_ENV?: string}).NODE_ENV;
    }
});

const createOrderElement = (id: string, key?: string) => ({
    id,
    getAttribute: (name: string) => name === "data-topbar-entry" && typeof key === "string" ? key : null,
});

class TestEvent {
    public defaultPrevented = false;
    public immediatePropagationStopped = false;
    public propagationStopped = false;

    constructor(public target: TestElement, public clientX: number, public clientY: number, public button = 0) {
    }

    public preventDefault() {
        this.defaultPrevented = true;
    }

    public stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
    }

    public stopPropagation() {
        this.propagationStopped = true;
    }
}

class TestEventTarget {
    private listeners = new Map<string, Set<(event: TestEvent) => void>>();

    public addEventListener(type: string, listener: (event: TestEvent) => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(listener);
    }

    public dispatch(type: string, event: TestEvent) {
        this.listeners.get(type)?.forEach((listener) => listener(event));
    }

    public listenerCount(type: string) {
        return this.listeners.get(type)?.size || 0;
    }

    public removeEventListener(type: string, listener: (event: TestEvent) => void) {
        this.listeners.get(type)?.delete(listener);
    }
}

class TestElement extends TestEventTarget {
    public children: TestElement[] = [];
    public className = "";
    public parentElement: TestElement | null = null;
    public style: Record<string, string> = {opacity: ""};
    private attributes = new Map<string, string>();

    constructor(public ownerDocument: TestDocument, public id = "", key?: string,
                private rect = {left: 0, top: 0, width: 24, height: 24}) {
        super();
        if (typeof key === "string") {
            this.attributes.set("data-topbar-entry", key);
        }
    }

    public after(element: TestElement) {
        this.insertRelative(element, 1);
    }

    public appendChild(element: TestElement) {
        element.remove();
        element.parentElement = this;
        this.children.push(element);
        return element;
    }

    public before(element: TestElement) {
        this.insertRelative(element, 0);
    }

    public cloneNode() {
        const clone = new TestElement(this.ownerDocument, this.id, undefined, this.rect);
        this.attributes.forEach((value, key) => clone.attributes.set(key, value));
        clone.className = this.className;
        clone.style = {...this.style};
        return clone;
    }

    public getAttribute(name: string) {
        if (name === "id") {
            return this.id || null;
        }
        return this.attributes.get(name) ?? null;
    }

    public getBoundingClientRect() {
        return this.rect;
    }

    public hasAttribute(name: string) {
        return this.attributes.has(name);
    }

    public remove() {
        if (!this.parentElement) {
            return;
        }
        const index = this.parentElement.children.indexOf(this);
        if (index > -1) {
            this.parentElement.children.splice(index, 1);
        }
        this.parentElement = null;
    }

    public removeAttribute(name: string) {
        if (name === "id") {
            this.id = "";
        } else {
            this.attributes.delete(name);
        }
    }

    public replaceWith(element: TestElement) {
        const parentElement = this.parentElement;
        if (!parentElement) {
            return;
        }
        element.remove();
        const index = parentElement.children.indexOf(this);
        parentElement.children.splice(index, 1, element);
        this.parentElement = null;
        element.parentElement = parentElement;
    }

    public setAttribute(name: string, value: string) {
        if (name === "id") {
            this.id = value;
        } else {
            this.attributes.set(name, value);
        }
    }

    private insertRelative(element: TestElement, offset: number) {
        const parentElement = this.parentElement;
        if (!parentElement) {
            return;
        }
        element.remove();
        const index = parentElement.children.indexOf(this);
        element.parentElement = parentElement;
        parentElement.children.splice(index + offset, 0, element);
    }
}

class TestDocument extends TestEventTarget {
    public body = new TestElement(this, "body");
    public readonly = false;
    private timerId = 0;
    private timers = new Set<number>();
    public defaultView = {
        siyuan: {config: {readonly: false}},
        clearTimeout: (id: number) => this.timers.delete(id),
        setTimeout: () => {
            this.timerId++;
            this.timers.add(this.timerId);
            return this.timerId;
        },
    };

    public createElement() {
        return new TestElement(this);
    }
}

const createToolbar = () => {
    const documentSelf = new TestDocument();
    const toolbar = new TestElement(documentSelf, "toolbar");
    const workspace = new TestElement(documentSelf, "barWorkspace", undefined, {left: 0, top: 0, width: 20, height: 24});
    const left = new TestElement(documentSelf, "barBack", "back", {left: 20, top: 0, width: 24, height: 24});
    const drag = new TestElement(documentSelf, "drag", undefined, {left: 44, top: 0, width: 100, height: 24});
    const right = new TestElement(documentSelf, "barSearch", "search", {left: 144, top: 0, width: 24, height: 24});
    const more = new TestElement(documentSelf, "barMore", undefined, {left: 168, top: 0, width: 24, height: 24});
    const controls = new TestElement(documentSelf, "windowControls", undefined, {left: 192, top: 0, width: 80, height: 24});
    [workspace, left, drag, right, more, controls].forEach((item) => toolbar.appendChild(item));
    return {controls, documentSelf, drag, left, more, right, toolbar, workspace};
};

describe("top bar drag", () => {
    it("reads only direct configurable entries and the fixed drag key", () => {
        const toolbar = {
            children: [
                createOrderElement("barWorkspace"),
                createOrderElement("barBack", "back"),
                createOrderElement("drag"),
                createOrderElement("barSearch", "search"),
                createOrderElement("barMore"),
                createOrderElement("windowControls"),
            ],
        } as unknown as HTMLElement;

        assert.deepEqual(topBarDrag.getTopBarOrder(toolbar), ["back", "drag", "search"]);
    });

    it("keeps fixed edge targets on their respective side", () => {
        const rect = {left: 100, width: 40} as DOMRect;

        assert.equal(topBarDrag.resolveTopBarDropSide("barWorkspace", 1000, rect), "after");
        assert.equal(topBarDrag.resolveTopBarDropSide("barMore", 0, rect), "before");
        assert.equal(topBarDrag.resolveTopBarDropSide("windowControls", 110, rect), undefined);
    });

    it("uses the horizontal midpoint for entries and the fixed drag area", () => {
        const rect = {left: 100, width: 40} as DOMRect;

        assert.equal(topBarDrag.resolveTopBarDropSide("left", 119, rect), "before");
        assert.equal(topBarDrag.resolveTopBarDropSide("left", 120, rect), "after");
        assert.equal(topBarDrag.resolveTopBarDropSide("drag", 101, rect), "before");
        assert.equal(topBarDrag.resolveTopBarDropSide("drag", 139, rect), "after");
    });

    it("recognizes self and adjacent insertions as no-ops", () => {
        assert.equal(topBarDrag.isTopBarDropNoop(2, 2, "before"), true);
        assert.equal(topBarDrag.isTopBarDropNoop(1, 2, "before"), true);
        assert.equal(topBarDrag.isTopBarDropNoop(2, 1, "after"), true);
        assert.equal(topBarDrag.isTopBarDropNoop(0, 2, "before"), false);
        assert.equal(topBarDrag.isTopBarDropNoop(2, 0, "after"), false);
    });

    it("moves an entry across drag, cleans up, and suppresses the generated click", () => {
        const {documentSelf, drag, left, toolbar} = createToolbar();
        const orders: string[][] = [];
        const unbind = topBarDrag.bindTopBarDrag(
            toolbar as unknown as HTMLElement,
            (order) => orders.push(order),
        );

        toolbar.dispatch("mousedown", new TestEvent(left, 30, 12));
        assert.equal(drag.getAttribute("data-topbar-reordering"), "true");
        documentSelf.dispatch("mousemove", new TestEvent(drag, 120, 12));
        assert.equal(documentSelf.body.children.length, 1);
        assert.equal(left.style.opacity, "0.38");
        documentSelf.dispatch("mouseup", new TestEvent(drag, 120, 12));

        assert.deepEqual(topBarDrag.getTopBarOrder(toolbar as unknown as HTMLElement), ["drag", "back", "search"]);
        assert.deepEqual(orders, [["drag", "back", "search"]]);
        assert.equal(documentSelf.body.children.length, 0);
        assert.equal(documentSelf.listenerCount("mousemove"), 0);
        assert.equal(documentSelf.listenerCount("mouseup"), 0);
        assert.equal(documentSelf.listenerCount("dragstart"), 0);
        assert.equal(left.style.opacity, "");
        assert.equal(drag.getAttribute("data-topbar-reordering"), null);

        const generatedClick = new TestEvent(left, 120, 12);
        toolbar.dispatch("click", generatedClick);
        assert.equal(generatedClick.defaultPrevented, true);
        assert.equal(generatedClick.immediatePropagationStopped, true);
        const nextClick = new TestEvent(left, 120, 12);
        toolbar.dispatch("click", nextClick);
        assert.equal(nextClick.defaultPrevented, false);

        unbind();
        assert.equal(toolbar.listenerCount("mousedown"), 0);
        assert.equal(toolbar.listenerCount("click"), 0);
    });

    it("ignores non-primary, readonly, and below-threshold mouse movement", () => {
        const {documentSelf, drag, left, toolbar} = createToolbar();
        let changeCount = 0;
        const unbind = topBarDrag.bindTopBarDrag(toolbar as unknown as HTMLElement, () => {
            changeCount++;
        });

        toolbar.dispatch("mousedown", new TestEvent(left, 30, 12, 2));
        assert.equal(documentSelf.listenerCount("mousemove"), 0);
        documentSelf.defaultView.siyuan.config.readonly = true;
        toolbar.dispatch("mousedown", new TestEvent(left, 30, 12));
        assert.equal(documentSelf.listenerCount("mousemove"), 0);

        documentSelf.defaultView.siyuan.config.readonly = false;
        toolbar.dispatch("mousedown", new TestEvent(left, 30, 12));
        documentSelf.dispatch("mousemove", new TestEvent(drag, 34, 16));
        documentSelf.dispatch("mouseup", new TestEvent(drag, 34, 16));
        assert.equal(drag.getAttribute("data-topbar-reordering"), null);
        const click = new TestEvent(left, 34, 16);
        toolbar.dispatch("click", click);

        assert.equal(changeCount, 0);
        assert.equal(click.defaultPrevented, false);
        assert.deepEqual(topBarDrag.getTopBarOrder(toolbar as unknown as HTMLElement), ["back", "drag", "search"]);
        unbind();
    });
});
