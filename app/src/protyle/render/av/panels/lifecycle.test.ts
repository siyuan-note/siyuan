import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IAVPanelContext, IOpenAVPanelOptions} from "./types";

const createPanel = (mobile = false) => {
    const calls: string[] = [];
    const events = new Map<string, (event: unknown) => unknown>();
    const observers: Array<() => void> = [];
    const positions: Array<{left: number, top: number}> = [];
    let onMenuRemove = () => {};
    let context: IAVPanelContext;
    let existing = false;
    let backTarget: HTMLElement;
    const menuClasses = new Set<string>();
    const menu = {isConnected: true, clientWidth: 100, dataset: {}, querySelector: (): null => null,
        classList: {contains: (name: string) => menuClasses.has(name)}};
    const panel = {isConnected: true, lastElementChild: menu, parentElement: {},
        remove: () => { existing = false; panel.isConnected = false; calls.push("remove"); },
        addEventListener: (name: string, callback: (event: unknown) => unknown) => events.set(name, callback)};
    const classes = {contains: () => true};
    const options: IOpenAVPanelOptions = {type: "config", data: {fields: []} as unknown as IAV,
        protyle: {toolbar: {subElement: {classList: classes}}} as unknown as IProtyle,
        blockElement: {getAttribute: (name: string) => name === "data-av-id" ? "av" : "block", classList: classes,
            querySelector: () => ({textContent: "", getBoundingClientRect: () => ({right: 300, bottom: 40, height: 20})})} as unknown as Element,
        destroyCallback: () => calls.push("destroy")};
    const dependencies = new Proxy({
        getPageSize: () => ({}), getFieldsByData: (data: IAV & {fields: IAVColumn[]}) => data.fields,
        escapeAttr: (value: string) => value, isMobile: () => mobile,
        getMobileAVPanelBackTarget: () => backTarget,
        getAVPanelDescriptor: () => ({render: (value: IAVPanelContext) => { context = value; value.html = "panel"; return true; },
            bind: (value: IAVPanelContext) => { value.closeCB = () => calls.push("closeCB"); }}),
        dispatchAVPanelAction: (value: IAVPanelContext) => { assert.equal(value, context); calls.push("action"); return "handled"; },
        Constants: {TIMEOUT_TRANSITION: 0},
        setPosition: (_element: HTMLElement, left: number, top: number) => {
            calls.push("setPosition");
            positions.push({left, top});
        },
    }, {get: (target, key) => key in target ? Reflect.get(target, key) : () => calls.push(String(key))});
    const exports: Record<string, unknown> = {};
    const source = readFileSync(path.join(__dirname, "../openMenuPanel.ts"), "utf8");
    runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, {
        exports, require: () => dependencies,
        document: {querySelector: () => existing ? panel : null, body: {insertAdjacentHTML: () => { existing = true; calls.push("insert"); }}},
        window: {siyuan: {zIndex: 0, menus: {menu: {remove: () => { calls.push("menu.remove"); onMenuRemove(); }, element: {classList: classes}}}},
            addEventListener: (name: string, callback: (event: unknown) => unknown) => {
                calls.push("resize.bind");
                events.set(name, callback);
            }, removeEventListener: () => calls.push("resize.unbind")},
        MutationObserver: class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} },
        setTimeout: (callback: () => void) => callback(),
    });
    const open = exports.openMenuPanel as typeof import("../openMenuPanel").openMenuPanel;
    const click = (detail: unknown) => events.get("click")({detail, target: {dataset: {}, closest: (): null => null}, preventDefault: () => {}, stopPropagation: () => {}});
    return {open, options, calls, click, observers, menuClasses, positions, resize: () => events.get("resize")({}),
        onMenuRemove: (callback: () => void) => { onMenuRemove = callback; },
        setBackTarget: () => {
            backTarget = {dataset: {type: "go-properties"}, closest: (): null => null} as unknown as HTMLElement;
        },
        get context() { return context; }, setExisting: () => { existing = true; }};
};

test("window resizing uses the automation height constraint only while its panel is open", () => {
    const h = createPanel();
    h.open(h.options);
    h.calls.length = 0;
    h.menuClasses.add("av__automation-panel");
    h.resize();
    assert.deepEqual(h.calls, ["setAutomationMenuPosition"]);
    h.calls.length = 0;
    h.menuClasses.delete("av__automation-panel");
    h.resize();
    assert.deepEqual(h.calls, ["setPosition"]);
});

for (const mobile of [false, true]) {
    test(`query filter panels save without database transactions or an editor (${mobile ? "mobile" : "desktop"})`, async () => {
        const h = createPanel(mobile);
        const saved: IAVFilter[][] = [];
        h.options.type = "filters";
        h.options.protyle = undefined;
        h.options.anchorElement = {getBoundingClientRect: () => ({right: 400, bottom: 50, width: 24, height: 20})} as HTMLElement;
        h.options.filterOperation = {save: filters => saved.push(filters)};
        h.open(h.options);
        await Promise.resolve();
        const filters: IAVFilter[] = [{combination: "and", filters: []}];
        h.context.saveFilters(filters, []);
        assert.equal(saved[0], filters);
        assert.equal(h.context.avID, "av");
        assert.ok(!h.calls.includes("transaction"));
        h.calls.length = 0;
        await h.click("close");
        assert.ok(h.calls.includes("remove"));
        assert.ok(!h.calls.includes("focusBlock"));
    });
}

test("query panels retain their anchor while loading and use a visible anchor again on resize", async () => {
    const h = createPanel();
    h.options.type = "filters";
    let rect = {right: 1500, bottom: 460, width: 24, height: 24} as DOMRect;
    h.options.anchorElement = {getBoundingClientRect: () => rect} as HTMLElement;
    h.onMenuRemove(() => { rect = {right: 0, bottom: 0, width: 0, height: 0} as DOMRect; });
    h.open(h.options);
    await Promise.resolve();
    assert.deepEqual(h.positions.at(-1), {left: 1400, top: 460});
    h.resize();
    assert.deepEqual(h.positions.at(-1), {left: 1400, top: 460});
    rect = {right: 800, bottom: 300, width: 24, height: 24} as DOMRect;
    h.resize();
    assert.deepEqual(h.positions.at(-1), {left: 700, top: 300});
});

test("query panels use the caller's captured position when a source refresh replaced the button", async () => {
    const h = createPanel();
    h.options.type = "filters";
    h.options.anchorElement = {getBoundingClientRect: () => ({right: 0, bottom: 0, width: 0, height: 0})} as HTMLElement;
    h.options.anchorRect = {right: 1500, bottom: 460, width: 24, height: 24} as DOMRect;
    h.open(h.options);
    await Promise.resolve();
    assert.deepEqual(h.positions.at(-1), {left: 1400, top: 460});
});

test("mobile back returns within a database panel and closes the root through its save callback", async () => {
    const h = createPanel(true);
    h.options.keepMenuOpen = true;
    h.open(h.options);
    h.calls.length = 0;
    h.setBackTarget();
    await h.click("back");
    assert.deepEqual(h.calls, ["action"]);
    const root = createPanel(true);
    root.options.keepMenuOpen = true;
    root.open(root.options);
    root.calls.length = 0;
    await root.click("back");
    assert.deepEqual(root.calls, ["closeCB", "remove", "focusBlock"]);
});

test("opening an existing panel destroys it without fetching or binding another panel", () => {
    const h = createPanel();
    h.setExisting();
    h.open(h.options);
    assert.deepEqual(h.calls, ["remove", "destroy"]);
});

test("reused data renders synchronously and closing releases the current callback and resize observer", async () => {
    const h = createPanel();
    h.open(h.options);
    assert.equal(h.context.data, h.options.data);
    assert.ok(h.calls.includes("resize.bind"));
    assert.ok(!h.calls.includes("fetchPost"));
    h.context.closeCB = () => h.calls.push("latest.closeCB");
    await h.click("close");
    h.observers.forEach(callback => callback());
    assert.ok(h.calls.includes("latest.closeCB"));
    assert.ok(!h.calls.includes("closeCB"));
    assert.ok(h.calls.includes("resize.unbind"));
    assert.ok(h.calls.includes("destroy"));
});

test("mobile panels share action dispatch and programmatic closing preserves a retained parent menu", async () => {
    const h = createPanel(true);
    h.options.keepMenuOpen = true;
    h.open(h.options);
    assert.ok(h.calls.includes("bindMobileAVPanel"));
    assert.ok(!h.calls.includes("resize.bind"));
    await h.click({type: "go-properties", target: {dataset: {}, closest: (): null => null}});
    assert.ok(h.calls.includes("action"));
    await h.click("close");
    assert.ok(h.calls.includes("closeCB"));
    assert.ok(!h.calls.includes("menu.remove"));
});
