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
    let context: IAVPanelContext;
    let existing = false;
    const menu = {isConnected: true, clientWidth: 100, dataset: {}, querySelector: (): null => null};
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
        getAVPanelDescriptor: () => ({render: (value: IAVPanelContext) => { context = value; value.html = "panel"; return true; },
            bind: (value: IAVPanelContext) => { value.closeCB = () => calls.push("closeCB"); }}),
        dispatchAVPanelAction: (value: IAVPanelContext) => { assert.equal(value, context); calls.push("action"); return "handled"; },
        Constants: {TIMEOUT_TRANSITION: 0},
    }, {get: (target, key) => key in target ? Reflect.get(target, key) : () => calls.push(String(key))});
    const exports: Record<string, unknown> = {};
    const source = readFileSync(path.join(__dirname, "../openMenuPanel.ts"), "utf8");
    runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, {
        exports, require: () => dependencies,
        document: {querySelector: () => existing ? panel : null, body: {insertAdjacentHTML: () => { existing = true; calls.push("insert"); }}},
        window: {siyuan: {zIndex: 0, menus: {menu: {remove: () => calls.push("menu.remove"), element: {classList: classes}}}},
            addEventListener: () => calls.push("resize.bind"), removeEventListener: () => calls.push("resize.unbind")},
        MutationObserver: class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} },
        setTimeout: (callback: () => void) => callback(),
    });
    const open = exports.openMenuPanel as typeof import("../openMenuPanel").openMenuPanel;
    const click = (detail: unknown) => events.get("click")({detail, target: {dataset: {}, closest: (): null => null}, preventDefault: () => {}, stopPropagation: () => {}});
    return {open, options, calls, click, observers, get context() { return context; }, setExisting: () => { existing = true; }};
};

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
