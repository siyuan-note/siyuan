import * as assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {IAVPanelContext, IAVPanelDescriptor, TAVPanelType} from "./types";

const createPanels = (overrides: Record<string, unknown> = {}) => {
    const calls: Array<[string, unknown[]]> = [];
    const timers: Array<() => void> = [];
    const state = {existingPanel: false};
    const languages = new Proxy({}, {get: (_target, key) => String(key)});
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const dependencies = new Proxy({
        getColIconByType: (type: string) => `icon-${type}`,
        unicode2Emoji: (icon: string) => `emoji-${icon}`,
        escapeHtml: escape,
        getFieldsByData: (data: {fields: IAVColumn[]}) => data.fields,
        Constants: {TIMEOUT_TRANSITION: 0},
        ...overrides,
    }, {get: (target, key) => key in target ? Reflect.get(target, key) : (...args: unknown[]) => {
        calls.push([String(key), args]);
        if (String(key).startsWith("get") && String(key).endsWith("HTML")) {
            return String(key);
        }
    }});
    const cache = new Map<string, Record<string, unknown>>();
    const load = (name: string): Record<string, unknown> => {
        if (cache.has(name)) {
            return cache.get(name);
        }
        const filename = path.join(__dirname, `${name}.ts`);
        const code = transpileModule(readFileSync(filename, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const exports: Record<string, unknown> = {};
        cache.set(name, exports);
        runInNewContext(code, {
            exports,
            require: (specifier: string) => specifier.startsWith("./") ? load(specifier.slice(2)) : dependencies,
            window: {siyuan: {languages, menus: {menu: {remove: () => calls.push(["menu.remove", []])}}},
                setTimeout: (callback: () => void) => timers.push(callback)},
            document: {querySelector: () => state.existingPanel ? {} : null},
            console,
        });
        return exports;
    };
    const registry = load("registry") as typeof import("./registry");
    return {registry, load, calls, timers, state};
};

const contextFor = (type: TAVPanelType, overrides: Partial<IAVPanelContext> = {}): IAVPanelContext => {
    const field = {id: "field", type: "text", name: "Field", hidden: false} as IAVColumn;
    const data = {id: "av", viewID: "view", viewType: "table", fields: [field], views: [],
        view: {wrapField: false, sorts: [], filters: []}} as unknown as IAV;
    return {
        options: {type, protyle: {} as IProtyle, blockElement: {
            isConnected: true, querySelector: () => ({getBoundingClientRect: () => ({right: 300, bottom: 40, height: 20})}),
        } as unknown as Element,
            cellElements: [{isConnected: true} as HTMLElement]},
        avID: "av", blockID: "block", isCustomAttr: false,
        fetchPayload: {id: "av"}, response: {data} as IWebSocketData,
        avPanelElement: {} as Element,
        menuElement: {innerHTML: "", clientWidth: 100, classList: {remove: () => {}}} as unknown as HTMLElement,
        tabRect: {right: 300, bottom: 40, height: 20} as DOMRect,
        cellRect: {left: 40, bottom: 80, height: 20} as DOMRect,
        saveFilters: () => {}, renderData: async () => {}, openPanel: () => {}, rerenderSwitcher: () => {},
        data, fields: [field], html: undefined, closeCB: undefined, relationDataRetryCount: 0, suppressSelectClick: false,
        ...overrides,
    };
};

test("all panel types render and the action registry preserves the existing action set", () => {
    const h = createPanels({getRelationHTML: () => "relation"});
    const types: TAVPanelType[] = ["select", "properties", "config", "sorts", "filters", "contextFilter", "edit", "date", "asset", "switcher", "relation", "rollup"];
    for (const type of types) {
        const context = contextFor(type);
        const descriptor = h.registry.getAVPanelDescriptor(type);
        assert.equal(descriptor.render(context), true, type);
        assert.equal(typeof context.html, "string", type);
    }
    const expected: string[] = JSON.parse(readFileSync(path.join(__dirname, "fixtures/actions.json"), "utf8"));
    assert.deepEqual(Array.from(h.registry.getAVPanelActionTypes()).sort(), expected.sort());
    assert.equal(h.registry.dispatchAVPanelAction(contextFor("config"), {
        type: "toString", target: {} as HTMLElement, event: {} as MouseEvent,
    }), "continue");
});

test("properties HTML preserves hidden fields, escaping and layout-specific primary controls", () => {
    const h = createPanels();
    const render = h.load("properties").getPropertiesHTML as typeof import("./properties").getPropertiesHTML;
    const baseline: {fields: IAVColumn[], goldens: Record<TAVView, string>} = JSON.parse(readFileSync(path.join(__dirname, "fixtures/properties.json"), "utf8"));
    for (const [viewType, hash] of Object.entries(baseline.goldens)) {
        assert.equal(createHash("sha256").update(render(baseline.fields, viewType as TAVView)).digest("hex"), hash, viewType);
    }
});

test("edit panel applies inherited wrapping and keeps field insertion order", () => {
    const h = createPanels();
    const context = contextFor("edit");
    const inserted = {id: "inserted", type: "text", name: "New"} as IAVColumn;
    context.options.editData = {previousID: "field", colData: inserted};
    h.registry.getAVPanelDescriptor("edit").render(context);
    assert.equal(inserted.wrap, false);
    assert.deepEqual(context.fields.map(item => item.id), ["field", "inserted"]);
});

test("relation retry preserves its limit and cancels after another panel opens", () => {
    const h = createPanels({getRelationHTML: () => "", fetchPost: (...args: unknown[]) => h.calls.push(["fetchPost", args])});
    const opened: string[] = [];
    const context = contextFor("relation", {openPanel: options => { opened.push(options.type); }});
    const descriptor: IAVPanelDescriptor = h.registry.getAVPanelDescriptor("relation");
    assert.equal(descriptor.render(context), false);
    assert.equal(context.relationDataRetryCount, 1);
    h.state.existingPanel = true;
    h.timers.shift()();
    assert.equal(h.calls.some(item => item[0] === "fetchPost"), false);
    context.relationDataRetryCount = 5;
    assert.equal(descriptor.render(context), false);
    assert.deepEqual(opened, ["edit"]);
});

test("navigation dispatches the destination action while retaining the initial panel type", () => {
    const h = createPanels();
    const context = contextFor("config");
    let prevented = 0;
    const event = {preventDefault: () => { prevented++; }, stopPropagation: () => {}} as MouseEvent;
    assert.equal(h.registry.dispatchAVPanelAction(context, {type: "go-properties", target: {} as HTMLElement, event}), "handled");
    assert.equal(context.options.type, "config");
    assert.ok(context.menuElement.innerHTML.includes('data-type="hideAllCol"'));
    assert.equal(prevented, 1);
    assert.ok(h.calls.some(([name]) => name === "setPosition"));
});

test("asynchronous group navigation consumes the current close callback and uses current field state", async () => {
    const h = createPanels();
    const context = contextFor("config", {
        menuElement: {innerHTML: "", querySelector: () => ({}), clientWidth: 100} as unknown as HTMLElement,
    });
    let closeCalls = 0;
    context.closeCB = async () => { closeCalls++; };
    const event = {preventDefault: () => {}, stopPropagation: () => {}} as MouseEvent;
    const result = h.registry.dispatchAVPanelAction(context, {type: "goGroups", target: {classList: {contains: () => true}} as unknown as HTMLElement, event});
    assert.equal(typeof result, "object");
    assert.equal(await result, "handled");
    assert.equal(closeCalls, 1);
    assert.equal(context.closeCB, undefined);
    assert.ok(h.calls.some(([name, args]) => name === "getGroupsHTML" && args[0] === context.fields));
});
