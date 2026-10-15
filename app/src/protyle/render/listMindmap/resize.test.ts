import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getListMindmapResizeSize, ListMindmapSize} from "./resize";

const compiled = transpileModule(readFileSync("src/protyle/render/listMindmap/resize.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class Target {
    listeners = new Map<string, Set<(event: any) => void>>();
    addEventListener(type: string, listener: (event: any) => void) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener);
    }
    dispatch(type: string, properties: Record<string, unknown> = {}) {
        const event = {button: 0, isPrimary: true, pointerId: 1, clientX: 500, clientY: 300,
            defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.stopped = true; }, ...properties};
        this.listeners.get(type)?.forEach(listener => listener(event));
        return event;
    }
}

class Style {
    width = "";
    height = "";
    flex = "";
    values = new Map<string, string>();
    priorities = new Map<string, string>();
    setProperty(key: string, value: string, priority = "") {
        this.values.set(key, value);
        this.priorities.set(key, priority);
    }
    getPropertyValue(key: string) { return this.values.get(key) || ""; }
    getPropertyPriority(key: string) { return this.priorities.get(key) || ""; }
    removeProperty(key: string) { this.values.delete(key); this.priorities.delete(key); }
}

class Element extends Target {
    classes = new Set<string>();
    classList = {contains: (name: string) => this.classes.has(name),
        add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name)};
    style = new Style();
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    children: Element[] = [];
    parentElement?: Element;
    isConnected = true;
    captured?: number;
    hidden = false;
    ownerDocument: {defaultView: Target, createElement: () => Element};
    baseWidth = 500;
    baseHeight = 300;
    left = 20;
    scale = 1;
    dispatch(type: string, properties: Record<string, unknown> = {}) {
        const event = super.dispatch(type, properties);
        if (!event.stopped && this.parentElement) {
            this.parentElement.dispatch(type, event);
        }
        return event;
    }
    get offsetWidth() { return parseFloat(this.style.width) || this.baseWidth; }
    get offsetHeight() { return parseFloat(this.style.getPropertyValue("--mindmap-view-height")) || this.baseHeight; }
    getBoundingClientRect() {
        return {left: this.left, right: this.left + this.offsetWidth * this.scale,
            width: this.offsetWidth * this.scale, height: this.offsetHeight * this.scale};
    }
    getAttribute(key: string) {
        return key === "style" ? `${this.style.width};${this.style.height};${this.style.flex}` : this.attributes.get(key);
    }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    appendChild(child: Element) { this.children.push(child); child.parentElement = this; }
    setPointerCapture(id: number) { this.captured = id; }
    hasPointerCapture(id: number) { return this.captured === id; }
    releasePointerCapture(id: number) {
        this.captured = undefined;
        this.dispatch("lostpointercapture", {pointerId: id});
    }
    remove() { this.isConnected = false; this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

const settle = async () => {
    for (let index = 0; index < 8; index++) {
        await Promise.resolve();
    }
};

const setup = () => {
    const windowSelf = new Target();
    const documentSelf = {defaultView: windowSelf, createElement: () => {
        const element = new Element();
        element.ownerDocument = documentSelf;
        return element;
    }};
    Object.assign(windowSelf, {getComputedStyle: (element: Element) => ({width: String(element.offsetWidth),
        paddingRight: "20px", borderRightWidth: "0px"})});
    const parent = documentSelf.createElement();
    parent.baseWidth = 1000;
    parent.left = 0;
    const block = documentSelf.createElement();
    block.style.height = "300px";
    const host = documentSelf.createElement();
    host.style.setProperty("--mindmap-view-height", "300px");
    parent.appendChild(block);
    block.appendChild(host);
    const commits: ListMindmapSize[] = [];
    let allowed = true;
    let prepare = async () => true;
    let observe: () => void;
    const exports: {bindListMindmapResize?: (options: unknown) => {refresh: () => void, destroy: () => void}} = {};
    runInNewContext(compiled, {exports, console,
        MutationObserver: class {
            constructor(callback: () => void) { observe = callback; }
            observe() {}
            disconnect() {}
        }});
    const binding = exports.bindListMindmapResize({block, host, labels: {width: "Width", height: "Height"},
        canResize: () => allowed, prepare: () => prepare(), commit: async (size: ListMindmapSize) => {
            commits.push({...size});
            if (size.width !== undefined) {
                block.style.width = `${size.width}px`;
                host.baseWidth = size.width;
            }
            if (size.height !== undefined) {
                block.style.height = `${size.height}px`;
                host.style.setProperty("--mindmap-view-height", `${size.height}px`);
            }
            return true;
        }});
    const handle = (axis = "both") => host.children.find(child => child.dataset.resizeAxis === axis);
    return {block, host, parent, windowSelf, commits, binding, handle,
        setAllowed: (value: boolean) => { allowed = value; binding.refresh(); },
        prepare: (callback: () => Promise<boolean>) => prepare = callback,
        observe: () => observe(),
        start: async (axis = "both", extra = {}) => {
            handle(axis).dispatch("pointerdown", extra);
            await settle();
        },
        move: (x: number, y: number, extra = {}) => windowSelf.dispatch("pointermove", {clientX: x, clientY: y, ...extra}),
        end: async (x: number, y: number, extra = {}) => {
            windowSelf.dispatch("pointerup", {clientX: x, clientY: y, ...extra});
            await settle();
        }};
};

test("resize geometry separates axes, accounts for editor scale and preserves already compact blocks", () => {
    const initial = {width: 500, height: 300, blockWidth: 500, maxWidth: 600, scaleX: 2, scaleY: 2};
    assert.deepEqual(getListMindmapResizeSize(initial, "both", 100, -100), {width: 550, height: 250});
    assert.deepEqual(getListMindmapResizeSize(initial, "width", 1000, 100), {width: 600});
    assert.deepEqual(getListMindmapResizeSize(initial, "both", -2000, -2000), {width: 120, height: 80});
    assert.deepEqual(getListMindmapResizeSize({...initial, width: 60, height: 40}, "both", -100, -100), {width: 60, height: 40});
    assert.deepEqual(getListMindmapResizeSize({...initial, maxWidth: 400}, "both", 0, 0), {width: 500, height: 300});
});

for (const pointerType of ["mouse", "touch"]) {
    test(`${pointerType} corner drag previews only the host and commits both dimensions once on release`, async () => {
        const fixture = setup();
        const before = fixture.block.getAttribute("style");
        await fixture.start("both", {pointerType});
        fixture.move(650, 400);
        assert.equal(fixture.host.style.width, "650px");
        assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "400px");
        assert.equal(fixture.block.getAttribute("style"), before);
        assert.equal(fixture.commits.length, 0);
        fixture.move(700, 450);
        await fixture.end(700, 450);
        assert.deepEqual(fixture.commits, [{width: 700, height: 450}]);
        assert.equal(fixture.host.style.width, "");
        assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "450px");
        assert.equal(fixture.handle().captured, undefined);
        assert.equal(fixture.handle().dispatch("touchstart").stopped, true);
        assert.equal(fixture.handle().getAttribute("data-prevent-swipe"), "true");
    });
}

test("individual handles preserve the other dimension and respect the parent content boundary", async () => {
    const fixture = setup();
    await fixture.start("width");
    await fixture.end(2000, 1000);
    assert.deepEqual(fixture.commits, [{width: 960}]);
    await fixture.start("height");
    await fixture.end(10, 200);
    assert.deepEqual(fixture.commits[1], {height: 200});
});

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "Escape", "destroy", "readonly", "fullscreen"]) {
    test(`${interruption} restores the preview without saving`, async () => {
        const fixture = setup();
        await fixture.start();
        fixture.move(650, 400);
        if (interruption === "lostpointercapture") {
            fixture.handle().dispatch(interruption);
        } else if (interruption === "Escape") {
            fixture.windowSelf.dispatch("keydown", {key: "Escape"});
        } else if (interruption === "destroy") {
            fixture.binding.destroy();
        } else if (interruption === "readonly") {
            fixture.setAllowed(false);
        } else if (interruption === "fullscreen") {
            fixture.host.classList.add("fullscreen");
            fixture.observe();
        } else {
            fixture.windowSelf.dispatch(interruption);
        }
        await fixture.end(650, 400);
        assert.deepEqual(fixture.commits, []);
        assert.equal(fixture.host.style.width, "");
        assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "300px");
    });
}

test("read-only, full screen and superblock widths cannot be resized", async () => {
    const fixture = setup();
    fixture.setAllowed(false);
    assert.ok(fixture.host.children.every(handle => handle.hidden));
    await fixture.start();
    await fixture.end(650, 400);
    fixture.setAllowed(true);
    fixture.parent.classList.add("sb");
    fixture.binding.refresh();
    assert.equal(fixture.handle("width").hidden, true);
    assert.equal(fixture.handle().hidden, true);
    assert.equal(fixture.handle("height").hidden, false);
    await fixture.start();
    await fixture.end(650, 400);
    assert.deepEqual(fixture.commits, []);
    await fixture.start("height");
    await fixture.end(650, 400);
    assert.deepEqual(fixture.commits, [{height: 400}]);
});

test("late editor completion cannot resurrect a released or destroyed drag", async () => {
    for (const destroy of [false, true]) {
        const fixture = setup();
        let release: (ready: boolean) => void;
        fixture.prepare(() => new Promise(resolve => release = resolve));
        await fixture.start();
        fixture.move(650, 400);
        if (destroy) {
            fixture.binding.destroy();
        } else {
            await fixture.end(650, 400);
        }
        release(true);
        await settle();
        assert.deepEqual(fixture.commits, []);
        assert.equal(fixture.host.style.width, "");
    }
});

test("a click, failed editor save or unrelated pointer does not save a size", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.move(700, 400, {pointerId: 2});
    await fixture.end(500, 300);
    fixture.prepare(async () => false);
    await fixture.start();
    await fixture.end(700, 400);
    assert.deepEqual(fixture.commits, []);
});

test("concurrent source style changes cancel the drag without replacing newer dimensions", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.move(650, 400);
    fixture.block.style.height = "50vh";
    await fixture.end(700, 450);
    assert.deepEqual(fixture.commits, []);
    assert.equal(fixture.block.style.height, "50vh");
    assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "50vh");
});

test("source refresh preserves an active preview but cancels when the saved dimensions change", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.move(650, 400);
    fixture.host.style.setProperty("--mindmap-view-height", fixture.block.style.height);
    fixture.binding.refresh();
    assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "400px");
    fixture.block.style.height = "50vh";
    fixture.host.style.setProperty("--mindmap-view-height", fixture.block.style.height);
    fixture.binding.refresh();
    assert.equal(fixture.host.style.getPropertyValue("--mindmap-view-height"), "50vh");
    await fixture.end(700, 450);
    assert.deepEqual(fixture.commits, []);
});

test("focused handles support precise keyboard resizing without consuming unrelated arrows", async () => {
    const fixture = setup();
    assert.equal(fixture.handle("width").dispatch("keydown", {key: "ArrowUp"}).defaultPrevented, false);
    assert.equal(fixture.handle("width").dispatch("keydown", {key: "ArrowRight"}).defaultPrevented, true);
    await settle();
    assert.deepEqual(fixture.commits, [{width: 510}]);
    fixture.handle("height").dispatch("keydown", {key: "ArrowDown", shiftKey: true});
    await settle();
    assert.deepEqual(fixture.commits[1], {height: 301});
    fixture.binding.destroy();
    assert.ok([...fixture.windowSelf.listeners.values()].every(listeners => listeners.size === 0));
});

test("handle focus navigation and typing never reach canvas node shortcuts", () => {
    const fixture = setup();
    let canvasKeys = 0;
    fixture.host.addEventListener("keydown", () => canvasKeys++);
    for (const key of ["Tab", "Enter", "Delete", "Backspace", "a", "ArrowUp"]) {
        const event = fixture.handle("width").dispatch("keydown", {key});
        assert.equal(event.defaultPrevented, false, key);
        assert.equal(event.stopped, true, key);
    }
    assert.equal(canvasKeys, 0);
});
