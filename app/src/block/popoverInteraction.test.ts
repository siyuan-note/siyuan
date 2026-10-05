import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../index";

class TestElement {
    attributes: Record<string, string> = {};
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    classes = new Set<string>();
    classList = {
        contains: (name: string) => this.classes.has(name),
        add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
        remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    };
    parentElement: TestElement;
    children: TestElement[] = [];
    isConnected = true;
    tagName = "SPAN";
    textContent = "Reference";
    innerHTML = "";
    id = "";
    get firstElementChild() { return this.children[0]; }
    get lastElementChild() { return this.children[this.children.length - 1]; }
    getAttribute(name: string) { return this.attributes[name] ?? null; }
    removeAttribute(name: string) { delete this.attributes[name]; }
    contains(target: TestElement): boolean { return target === this || this.children.some(child => child.contains(target)); }
    closest(selector: string): TestElement {
        if (selector.startsWith(".") && this.classes.has(selector.substring(1))) {
            return this;
        }
        return this.parentElement?.closest(selector) || null;
    }
    querySelector(selector: string): TestElement {
        return this.children.find(child => selector.startsWith(".") && child.classes.has(selector.substring(1))) || null;
    }
    querySelectorAll(): TestElement[] { return []; }
    addEventListener() {}
    remove() { this.isConnected = false; }
    getBoundingClientRect() { return {left: 0, top: 0, bottom: 20, width: 100, height: 20}; }
}

const loadModule = (filename: string, globals: Record<string, unknown>, dependencies: Record<string, unknown>) => {
    const exports: Record<string, unknown> = {};
    runInNewContext(transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: (name: string) => dependencies[name] || {}, ...globals});
    return exports;
};

const createHarness = (android = false) => {
    const body = new TestElement();
    const element = (attributes: Record<string, string> = {}, classes: string[] = [], parent = body) => {
        const result = new TestElement();
        result.attributes = attributes;
        result.classes = new Set(classes);
        result.parentElement = parent;
        parent.children.push(result);
        return result;
    };
    const ref = element({"data-type": "block-ref", "data-id": "reference"});
    const handlers = new Map<string, {callback: (event: unknown) => void, capture: boolean}[]>();
    let now = 0;
    let timerID = 0;
    const timers = new Map<number, {at: number, callback: () => void}>();
    const setTimer = (callback: () => void, delay = 0) => {
        const id = ++timerID;
        timers.set(id, {at: now + delay, callback});
        return id;
    };
    const clearTimer = (id: number) => timers.delete(id);
    const panels: {element: TestElement, targetElement: TestElement, canShow?: () => boolean,
        refDefs: IRefDefs[], editors: unknown[], destroy: () => void}[] = [];
    const requests: {url: string, resolve: (data: unknown) => void}[] = [];
    const siyuan = {
        config: {editor: {floatWindowMode: 0, floatWindowDelay: 20}},
        menus: {menu: {element: element({}, ["fn__none"]), data: undefined as unknown}},
        blockPanels: panels,
        shiftIsPressed: false, ctrlIsPressed: false, altIsPressed: false, zIndex: 0,
    };
    const closest = (target: TestElement, predicate: (item: TestElement) => boolean): TestElement | false => {
        for (let item = target; item; item = item.parentElement) {
            if (predicate(item)) {
                return item;
            }
        }
        return false;
    };
    let touch = false;
    const globals = {
        window: {siyuan, JSAndroid: android ? {} : undefined, setTimeout: setTimer, addEventListener() {}},
        document: {
            body, onmousemove: null as unknown,
            contains: (target: TestElement) => Boolean(target?.isConnected),
            addEventListener: (name: string, callback: (event: unknown) => void, options?: {capture?: boolean}) => {
                handlers.set(name, [...handlers.get(name) || [], {callback, capture: Boolean(options?.capture)}]);
            },
        },
        clearTimeout: clearTimer, setTimeout: setTimer,
        Element: TestElement, HTMLImageElement: class {},
        getSelection: () => ({rangeCount: 0}), performance: {now: () => now},
    };
    const lifecycle = loadModule("src/block/popoverLifecycle.ts", globals, {
        "../util/zIndex": {isAbove: (a: TestElement, b: TestElement) => Number(a.style.zIndex) > Number(b.style.zIndex)},
    }) as unknown as
        typeof import("./popoverLifecycle");
    const api = loadModule("src/block/popover.ts", globals, {
        "./popoverLifecycle": lifecycle,
        "./Panel": {BlockPanel: class {
            element = element({"data-pin": "false"});
            editors: unknown[] = [];
            constructor(options: unknown) { Object.assign(this, options); }
            destroy() { panels.splice(panels.indexOf(this as unknown as typeof panels[number]), 1); }
        }},
        "../protyle/util/hasClosest": {
            hasClosestByClassName: (target: TestElement, name: string) => closest(target, item => item.classes.has(name)),
            hasClosestByAttribute: (target: TestElement, name: string, value: string) =>
                closest(target, item => value === null ? Boolean(item.getAttribute(name)) :
                    Boolean(item.getAttribute(name)?.split(" ").includes(value))),
        },
        "../util/fetch": {fetchSyncPost: (url: string) => new Promise(resolve => requests.push({url, resolve}))},
        "../util/pathName": {isEncryptedBox: () => false, isLocalPath: () => false,
            parseSiYuanUriInfo: (href: string) => ({id: href.split("/").pop()})},
        "../protyle/render/av/cellOverflow": {shouldMeasureAVCellContentOverflow: () => false},
        "../dialog/tooltip": {hideTooltip() {}, showTooltip() {}},
        "../constants": {Constants: {TIMEOUT_INPUT: 5}},
        "../util/functions": {isTouchDevice: () => touch},
        "../protyle/wysiwyg/listContext": {isListItemActionElement: () => false},
        "../util/zIndex": {isAbove: () => false},
    }) as unknown as typeof import("./popover");
    api.initBlockPopover({} as App);
    const fire = (name: string, target = ref, options: Record<string, unknown> = {}) => {
        const event = {type: name, target, clientX: 10, clientY: 10, buttons: 0, button: 0,
            pointerType: "mouse", stopPropagation() {}, ...options};
        handlers.get(name)?.forEach(handler => handler.callback(event));
    };
    const advance = async (duration = 30) => {
        const until = now + duration;
        while (true) {
            const next = [...timers.entries()].filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) {
                break;
            }
            now = next[1].at;
            timers.delete(next[0]);
            next[1].callback();
            await Promise.resolve();
        }
        now = until;
        await new Promise(resolve => setImmediate(resolve));
    };
    const open = (menu = siyuan.menus.menu.element) => {
        menu.classList.remove("fn__none");
        menu.style.zIndex = String(++siyuan.zIndex);
        lifecycle.setPopoverMenuOpen(menu as unknown as HTMLElement, true);
    };
    const close = (menu = siyuan.menus.menu.element) => {
        menu.classList.add("fn__none");
        lifecycle.setPopoverMenuOpen(menu as unknown as HTMLElement, false);
    };
    return {element, ref, fire, advance, api, lifecycle, panels, requests, siyuan, handlers, open, close,
        setTouch: (value: boolean) => { touch = value; }};
};

test("clicks cancel pending previews until actual motion, including within the same target", async () => {
    for (const button of [0, 1, 2]) {
        const h = createHarness();
        h.fire("mouseover");
        h.fire("pointerdown", h.ref, {button, buttons: 1 << button});
        await h.advance();
        assert.equal(h.panels.length, 0);
        h.fire("mouseover");
        h.fire("pointermove");
        await h.advance();
        assert.equal(h.panels.length, 0, "unchanged coordinates do not rearm");
        h.fire("pointermove", h.ref, {clientX: 11});
        await h.advance(19);
        assert.equal(h.panels.length, 0);
        await h.advance(1);
        assert.equal(h.panels.length, 1, "the complete configured delay is used");
    }
});

test("crossing a child before pointermove still resumes after a click", async () => {
    const h = createHarness();
    const child = h.element({}, [], h.ref);
    h.fire("mouseover");
    h.fire("pointerdown");
    h.fire("mouseover", child, {clientX: 30});
    h.fire("pointermove", child, {clientX: 30});
    await h.advance();
    assert.equal(h.panels.length, 1);
});

test("document icons, block references and both SiYuan link forms share cancellation and recovery", async () => {
    for (const kind of ["reference", "tree", "breadcrumb", "database", "search", "bookmark", "gutter", "hint", "link", "url"]) {
        const h = createHarness();
        if (["tree", "breadcrumb", "search", "bookmark", "gutter", "hint"].includes(kind)) {
            h.ref.attributes = {"data-id": kind};
            h.ref.classes.add("popover__block");
        } else if (kind === "link") {
            h.ref.attributes = {"data-type": "a", "data-href": "siyuan://blocks/document"};
        } else if (kind === "url") {
            const cell = h.element({}, ["av__cell"]);
            h.ref.parentElement = cell;
            cell.children.push(h.ref);
            h.ref.classes.add("av__celltext--url");
            h.ref.attributes = {"data-type": "url"};
            h.ref.dataset.type = "url";
            h.ref.dataset.href = "siyuan://blocks/document";
        }
        h.fire("mouseover");
        h.fire("pointerdown");
        h.open();
        await h.advance();
        assert.equal(h.panels.length, 0, kind);
        h.close();
        h.fire("pointermove", h.ref, {clientX: 20});
        await h.advance();
        assert.equal(h.panels.length, 1, kind);
    }
});

test("contextmenu capture and menu lifecycle cancel timers without pointer events", async () => {
    for (const cancel of [(h: ReturnType<typeof createHarness>) => h.fire("contextmenu"),
        (h: ReturnType<typeof createHarness>) => h.open()]) {
        const h = createHarness();
        h.fire("mouseover");
        cancel(h);
        await h.advance();
        assert.equal(h.panels.length, 0);
        assert.equal(h.handlers.get("contextmenu")[0].capture, true);
        assert.equal(h.handlers.get("pointerdown")[0].capture, true);
    }
});

test("visible menus block background hover and closing them does not replay it", async () => {
    const h = createHarness();
    h.fire("mouseover");
    h.open();
    h.fire("pointermove", h.ref, {clientX: 20});
    h.fire("mouseover", h.ref, {clientX: 20});
    await h.advance();
    assert.equal(h.panels.length, 0);
    h.close();
    h.fire("mouseover", h.ref, {clientX: 20});
    h.fire("pointermove", h.ref, {clientX: 20});
    await h.advance();
    assert.equal(h.panels.length, 0);
    h.fire("pointermove", h.ref, {clientX: 21});
    await h.advance();
    assert.equal(h.panels.length, 1);
});

test("keyboard context-menu coordinates do not replace the stationary pointer position", async () => {
    const h = createHarness();
    h.fire("mouseover");
    h.fire("contextmenu", h.ref, {clientX: 0, clientY: 0});
    h.open();
    h.close();
    h.fire("mouseover");
    h.fire("pointermove");
    await h.advance();
    assert.equal(h.panels.length, 0);
    h.fire("pointermove", h.ref, {clientX: 11});
    await h.advance();
    assert.equal(h.panels.length, 1);
});

test("late virtual, backlink, mirror and PDF queries cannot reopen after a menu closes", async () => {
    for (const kind of ["virtual", "backlink", "mirror", "pdf"]) {
        const h = createHarness();
        if (kind === "virtual") {
            h.ref.attributes = {"data-type": "virtual-block-ref"};
        } else if (kind === "backlink") {
            h.ref.attributes = {};
            h.ref.classes.add("popover__block");
            h.ref.classes.add("counter");
        } else if (kind === "mirror") {
            h.ref.attributes = {};
            h.ref.classes.add("popover__block");
            h.ref.dataset.popoverUrl = "/api/av/getMirrorDatabaseBlocks";
        } else {
            h.ref.attributes = {"data-node-id": "annotation"};
            h.ref.classes.add("popover__block");
            h.ref.classes.add("pdf__rect");
        }
        h.fire("mouseover");
        await h.advance();
        assert.equal(h.requests.length, 1, kind);
        h.open();
        h.close();
        h.requests[0].resolve({code: 0, data: {refDefs: [{refID: "late"}]}});
        await h.advance();
        assert.equal(h.panels.length, 0, kind);
    }
});

test("loading hover panels become invalid, while explicit previews retain their own behavior", async () => {
    const h = createHarness();
    h.fire("mouseover");
    await h.advance();
    const pending = h.panels[0];
    assert.equal(pending.canShow(), true);
    h.open();
    h.close();
    assert.equal(pending.canShow(), false);
    assert.equal(h.panels[0], pending, "cancellation does not destroy visible or pinned panels");
    await h.api.showPopover({} as App);
    assert.equal(h.panels[1].canShow, undefined, "explicit Ctrl/Shift entry does not require pointer movement");
});

test("marked menu references remain usable, independent menus and other windows are isolated", async () => {
    const h = createHarness();
    const menu = h.element({}, ["b3-menu"]);
    const inside = h.element({"data-type": "block-ref", "data-id": "inside"}, [], menu);
    h.open(menu);
    h.fire("pointermove", inside, {clientX: 20});
    await h.advance();
    assert.equal(h.panels.length, 1);
    const other = h.element({}, ["b3-menu"]);
    h.open(other);
    assert.equal(h.lifecycle.isPopoverMenuBlocked(inside as unknown as HTMLElement), true);
    h.close(other);
    assert.equal(h.lifecycle.isPopoverMenuBlocked(inside as unknown as HTMLElement), false);
    const anotherWindow = createHarness();
    anotherWindow.fire("mouseover");
    await anotherWindow.advance();
    assert.equal(anotherWindow.panels.length, 1);
});

test("database relation panels above a retained menu keep their own reference previews", async () => {
    const h = createHarness();
    h.open();
    const panel = h.element({}, ["av__panel"]);
    panel.style.zIndex = "2";
    const ref = h.element({"data-id": "relation"}, ["popover__block"], panel);
    h.fire("pointermove", ref, {clientX: 30});
    await h.advance();
    assert.equal(h.panels.length, 1);
    panel.style.zIndex = "0";
    assert.equal(h.lifecycle.isPopoverMenuBlocked(ref as unknown as HTMLElement), true);
});

test("explicit Shift queries survive click cancellation but still respect mindmap suspension", async () => {
    for (const suspended of [false, true]) {
        const h = createHarness();
        h.siyuan.shiftIsPressed = true;
        h.fire("mouseover");
        assert.equal(h.requests.length, 1);
        h.fire("pointerdown");
        h.open();
        h.close();
        if (suspended) {
            const resume = h.api.suspendBlockPopover(h.ref as unknown as HTMLElement,
                {target: h.ref} as unknown as PointerEvent);
            resume();
        }
        h.requests[0].resolve({code: 0, data: {refDefs: [{refID: "explicit"}]}});
        await h.advance();
        assert.equal(h.panels.length, suspended ? 0 : 1);
    }
});

test("pen presses cancel mouse and pen previews, while touch never rearms mouse hover", async () => {
    const h = createHarness(true);
    h.fire("pointerover", h.ref, {pointerType: "pen"});
    h.fire("pointerdown", h.ref, {pointerType: "pen", buttons: 1});
    await h.advance();
    assert.equal(h.panels.length, 0);
    h.fire("pointermove", h.ref, {pointerType: "pen", clientX: 20, buttons: 1});
    await h.advance();
    assert.equal(h.panels.length, 0);
    h.fire("pointermove", h.ref, {pointerType: "pen", clientX: 21});
    await h.advance();
    assert.equal(h.panels.length, 1);
    const touch = createHarness();
    touch.setTouch(true);
    touch.fire("mouseover");
    touch.fire("pointerdown", touch.ref, {pointerType: "touch"});
    touch.fire("pointermove", touch.ref, {pointerType: "touch", clientX: 30});
    await touch.advance();
    assert.equal(touch.panels.length, 0);
});

test("pen cancellation also invalidates a query already in flight", async () => {
    const h = createHarness(true);
    h.ref.attributes = {"data-type": "virtual-block-ref"};
    h.fire("pointerover", h.ref, {pointerType: "pen"});
    await h.advance();
    assert.equal(h.requests.length, 1);
    h.fire("pointercancel", h.ref, {pointerType: "pen"});
    h.requests[0].resolve({code: 0, data: {refDefs: [{refID: "late"}]}});
    await h.advance();
    assert.equal(h.panels.length, 0);
});

test("hover preferences, excluded targets and mindmap suspension remain effective", async () => {
    for (const excluded of ["disabled", "modifier", "prevent", "history", "suspended"]) {
        const h = createHarness();
        if (excluded === "disabled") { h.siyuan.config.editor.floatWindowMode = 2; }
        if (excluded === "modifier") { h.siyuan.altIsPressed = true; }
        if (excluded === "prevent") { h.ref.attributes["prevent-popover"] = "true"; }
        if (excluded === "history") { h.ref.classes.add("history__repo"); }
        if (excluded === "suspended") {
            h.api.suspendBlockPopover(h.ref as unknown as HTMLElement,
                {target: h.ref} as unknown as PointerEvent);
        }
        h.fire("mouseover");
        h.fire("pointerdown");
        h.fire("pointermove", h.ref, {clientX: 30});
        await h.advance();
        assert.equal(h.panels.length, 0, excluded);
    }
});

test("the real Panel first-load callback discards canceled hover and leaves explicit or opened panels alone", () => {
    const globals = {
        window: {siyuan: {zIndex: 5, languages: {}, config: {keymap: {
            general: {closeTab: {custom: ""}}, editor: {general: {openInNewTab: {custom: ""}}},
        }}}},
        document: {body: {contains: () => true}, contains: (element: TestElement) => Boolean(element?.isConnected)},
        ResizeObserver: class { observe() {} }, IntersectionObserver: class { observe() {} },
    };
    const module = loadModule("src/block/Panel.ts", globals, {
        "../protyle/util/compatibility": {updateHotkeyAfterTip: () => ""},
        "../layout/getTopBarHeight": {getTopBarHeight: () => 0},
        "./panelPosition": {positionBlockPanel() {}},
    }) as unknown as {BlockPanel: {prototype: {render: () => void}}};
    for (const automatic of [false, true]) {
        for (const cancelled of [false, true]) {
            const element = new TestElement();
            const editorElement = new TestElement();
            const content = new TestElement();
            element.querySelectorAll = () => [editorElement];
            element.querySelector = () => content;
            let valid = true;
            let after: () => void;
            let destroyed = false;
            const panel = {
                element, targetElement: new TestElement(), refDefs: [{refID: "reference"}],
                refDefElements: new Map(), editors: [] as unknown[],
                canShow: automatic ? () => valid : undefined,
                bindEditorResize() {},
                initProtyle: (_element: TestElement, callback: () => void) => { after = callback; },
                destroy: (removeMenu: boolean) => {
                    assert.equal(removeMenu, false, "canceling a loading preview preserves the active menu");
                    destroyed = true;
                    panel.element = undefined;
                },
            };
            module.BlockPanel.prototype.render.call(panel);
            valid = !cancelled;
            after();
            assert.equal(destroyed, automatic && cancelled);
            assert.equal(element.classes.has("block__popover--open"), !(automatic && cancelled));
            if (!destroyed) {
                valid = false;
                after();
                assert.equal(destroyed, false, "already displayed panels are not canceled later");
            }
        }
    }
});

test("destroying a canceled loading panel preserves a menu owned by another panel at the same level", () => {
    let closed = 0;
    const menu = new TestElement();
    menu.dataset.from = "1popover";
    const module = loadModule("src/block/Panel.ts", {
        window: {siyuan: {blockPanels: [], menus: {menu: {element: menu, remove: () => closed++}}}},
    }, {}) as unknown as {BlockPanel: {prototype: {destroy: (removeMenu?: boolean) => void}}};
    for (const removeMenu of [false, true]) {
        const element = new TestElement();
        element.dataset.level = "1";
        const panel = {element, editors: [] as unknown[], refDefElements: new Map(),
            refDefEditors: new Map(), refDefInfos: new Map()};
        module.BlockPanel.prototype.destroy.call(panel, removeMenu);
        assert.equal(closed, removeMenu ? 1 : 0);
        assert.equal(element.isConnected, false);
    }
});

test("the real Menu popup, fullscreen and removal notify hover cancellation for every menu instance", () => {
    const events: {element: TestElement, open: boolean}[] = [];
    const module = loadModule("src/menus/Menu.ts", {
        window: {siyuan: {zIndex: 0, languages: {}}, addEventListener() {}},
        clearTimeout() {}, setTimeout() {},
    }, {
        "../util/functions": {isMobile: () => false},
        "./menuGroup": {updateMenuItemGroupClasses() {}},
        "../config/entryVisibility/runtime": {applyMenuEntryVisibility() {}},
        "../block/popoverLifecycle": {setPopoverMenuOpen: (element: TestElement, open: boolean) => events.push({element, open})},
    }) as unknown as {Menu: {prototype: {popup: () => void, fullscreen: () => void, remove: () => void}}};
    for (const mode of ["popup", "fullscreen"] as const) {
        const element = new TestElement();
        const title = new TestElement();
        title.querySelector = () => new TestElement();
        const items = new TestElement();
        items.innerHTML = "Menu content";
        element.children = [title, items];
        const menu = Object.assign(Object.create(module.Menu.prototype), {
            element, emitCommonMenu() {}, setPopupPosition() {}, startTrackingTargetPosition() {},
            stopTrackingTargetPosition() {}, hideFullscreenScrim() {}, finishSheetTouch() {}, removeScrollEvent() {},
        });
        menu[mode]({x: 1, y: 2});
        assert.equal(events[events.length - 1].element, element);
        assert.equal(events[events.length - 1].open, true);
        menu.remove();
        assert.equal(events[events.length - 1].open, false);
        assert.equal(element.classList.contains("fn__none"), true);
    }
});
