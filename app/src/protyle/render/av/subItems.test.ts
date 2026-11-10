import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as relationPreview from "./subItemsRelationPreview";

const setup = () => {
    const operations: IOperation[] = [];
    const inserted: unknown[] = [];
    const callbacks: Array<() => void> = [];
    const requests: Array<{path: string; payload: unknown}> = [];
    let fetchResponse: () => Promise<unknown> = async () => ({code: -1});
    const module = {exports: {}};
    const languages = new Proxy({}, {get: (_value, key) => String(key)});
    const siyuan = {languages, isPublish: false};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "subItems.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {module, exports: module.exports, window: {siyuan},
        require: (id: string) => ({
            "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "view"}},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, values: IOperation[], _undo: IOperation[], options?: {callback?: () => void}) => {
                operations.push(...values);
                if (options?.callback) callbacks.push(options.callback);
            }},
            "../../../util/fetch": {fetchSyncPost: (path: string, payload: unknown) => {
                requests.push({path, payload});
                return fetchResponse();
            }},
            "./view": {getFieldsByData: (data: IAV) => (data.view as IAVTable).columns},
            "./virtualScroll": {getAVData: (): IAV | undefined => undefined},
            "./subItemsRelationPreview": relationPreview,
            "./row": {insertRows: (value: unknown) => inserted.push(value)},
            "./subItemsState": {toggleSubItems: () => {}},
            "./filteredTip": {getAVFilteredTipContext: () => ({filteredTipScope: "target"})},
            "../../../util/functions": {isMobile: () => false},
            "../../../util/escape": {escapeAttr: (value: string) => value, escapeHtml: (value: string) => value},
        }[id] || {}),
    });
    const block = {isConnected: true, dataset: {avId: "db", nodeId: "carrier"},
        hasAttribute: () => true, getAttribute: () => "view"} as unknown as HTMLElement;
    const protyle = {options: {}} as IProtyle;
    return {api: module.exports as typeof import("./subItems"), operations, inserted, block, protyle, siyuan,
        callbacks, requests, setResponse: (response: () => Promise<unknown>) => { fetchResponse = response; }};
};

it("reparents a deduplicated selection with a complete-sibling anchor and refuses stale readonly actions", () => {
    const h = setup();
    h.api.reparentSubItems(h.protyle, h.block, ["child", "child"], "parent", undefined, "next-page-first", "target-group");
    assert.equal(h.operations.length, 1);
    const operation = h.operations[0];
    assert.equal(operation.action, "reparentAttrViewItems");
    assert.deepEqual([...operation.srcIDs], ["child"]);
    assert.equal(operation.nextID, "next-page-first");
    assert.equal(operation.viewID, "view");
    assert.equal(operation.groupID, "target-group");
    h.protyle.disabled = true;
    h.api.reparentSubItems(h.protyle, h.block, ["child"], "");
    assert.equal(h.operations.length, 1);
});

it("offers shared row actions and creates a sub-item under its parent in one insert call", () => {
    const h = setup();
    const items: IMenu[] = [];
    h.api.addSubItemsMenu({addItem: (item: IMenu) => items.push(item)} as unknown as import("../../../plugin/Menu").Menu,
        h.protyle, h.block, ["parent"], "group");
    const add = items.find(item => item.id === "avAddSubItem");
    add.click(undefined, undefined);
    assert.equal(h.inserted.length, 1);
    assert.equal((h.inserted[0] as {parentID: string}).parentID, "parent");
    items.find(item => item.id === "avPromoteSubItem").click(undefined, undefined);
    assert.equal(h.operations[0].action, "promoteAttrViewItems");
    h.siyuan.isPublish = true;
    add.click(undefined, undefined);
    assert.equal(h.inserted.length, 1);
});

it("keeps nesting choices limited to table/list while exposing database configuration in every layout", () => {
    const h = setup();
    for (const viewType of ["table", "list", "gallery", "kanban", "calendar"] as TAVView[]) {
        const disabled = h.api.getSubItemsSettingsHTML({viewType, view: {}} as IAV);
        assert.match(disabled, /avEnableSubItems/);
        assert.doesNotMatch(disabled, /data-sub-items-field|data-sub-items-parent-key|go-sub-items-existing/);
        assert.doesNotMatch(disabled, /b3-menu__item--readonly/);
        assert.match(disabled, /^<div class="b3-menu__items">/);
        assert.match(disabled, /block__icon--menu-back" data-type="go-config"/);
        assert.match(disabled, /b3-menu__label ft__center/);
        const html = h.api.getSubItemsSettingsHTML({viewType, view: {subItemsDisplay: "nested"},
            subItems: {enabled: true, parentKeyID: "parent", childrenKeyID: "children"}} as IAV);
        assert.match(html, /avDisableSubItems/);
        assert.equal(html.includes('data-sub-items-display="nested"'), viewType === "table" || viewType === "list");
        assert.equal(html.includes('class="b3-menu__checked"'), viewType === "table" || viewType === "list");
    }
});

it("groups reciprocal fields and previews both directions before enabling the selected pair", () => {
    const h = setup();
    const field = {dataset: {subItemsPair: "children/parent"}, setAttribute() {},
        querySelector: () => ({classList: {toggle() {}}}), onclick: (event: MouseEvent) => { assert.ok(event); }};
    const enabled = {disabled: true, onclick: () => {}};
    const reverse = {onclick: (event: MouseEvent) => { assert.ok(event); }};
    const preview = {innerHTML: "", classList: {remove() {}}, querySelector: () => reverse};
    const menu = {querySelector: (selector: string) => selector === "[data-sub-items-preview]" ? preview : enabled,
        querySelectorAll: (selector: string) => selector === "[data-sub-items-pair]" ? [field] : [],
        closest: () => ({remove() {}})} as unknown as HTMLElement;
    const data = {id: "db", view: {columns: [{id: "parent", name: "Parent", type: "relation",
        relation: {avID: "db", isTwoWay: true, backKeyID: "children"}}, {id: "children", name: "Children", type: "relation",
        relation: {avID: "db", isTwoWay: true, backKeyID: "parent"}}], rows: [
        {id: "project", cells: [{valueType: "block", value: {block: {content: "Project"}}}]},
        {id: "task", cells: [{valueType: "block", value: {block: {content: "Task"}}},
            {value: {keyID: "parent", relation: {blockIDs: ["project"]}}}]},
    ]}} as IAV;
    const root = h.api.getSubItemsSettingsHTML(data);
    assert.match(root, /go-sub-items-existing/);
    assert.doesNotMatch(root, /data-sub-items-parent-key|avSubItemsNewFields/);
    const advanced = h.api.getSubItemsSettingsHTML(data, true);
    assert.match(advanced, /avSubItemsParentFieldTip/);
    assert.equal((advanced.match(/data-sub-items-pair=/g) || []).length, 1);
    assert.match(advanced, /data-type="go-sub-items"/);
    h.api.bindSubItemsSettings(menu, h.protyle, h.block, data, true);
    enabled.onclick();
    assert.equal(h.operations.length, 0);
    field.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    assert.equal(enabled.disabled, false);
    assert.equal(h.operations.length, 0);
    assert.match(preview.innerHTML, /Project/);
    assert.match(preview.innerHTML, /Task/);
    reverse.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    assert.ok(preview.innerHTML.indexOf(">Task<") < preview.innerHTML.indexOf(">Project<"));
    reverse.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    enabled.onclick();
    const operation = h.operations[0];
    assert.equal(operation.action, "setAttrViewSubItems");
    if (operation.action === "setAttrViewSubItems") {
        assert.equal(operation.data.parentKeyID, "parent");
        assert.equal(operation.data.childrenKeyID, "children");
    }
    h.api.bindSubItemsSettings(menu, h.protyle, h.block, data, true);
    field.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    reverse.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    enabled.onclick();
    assert.equal(h.operations[1].action, "setAttrViewSubItems");
    if (h.operations[1].action === "setAttrViewSubItems") {
        assert.equal(h.operations[1].data.parentKeyID, "children");
        assert.equal(h.operations[1].data.childrenKeyID, "parent");
    }
});

it("one-click enabling delegates field setup without requiring a relation selection", () => {
    const h = setup();
    const enabled = {onclick: () => {}};
    const menu = {querySelector: () => enabled, querySelectorAll: (): HTMLElement[] => [], closest: () => ({remove() {}})} as unknown as HTMLElement;
    const data = {id: "db", subItems: {enabled: false, parentKeyID: "old-parent"}, view: {columns: []}} as IAV;
    h.api.bindSubItemsSettings(menu, h.protyle, h.block, data);
    enabled.onclick();
    const operation = h.operations[0];
    assert.equal(operation.action, "setAttrViewSubItems");
    if (operation.action === "setAttrViewSubItems") {
        assert.equal(operation.data.enabled, true);
        assert.equal(operation.data.parentKeyID, undefined);
        assert.equal(operation.data.childrenKeyID, undefined);
    }
});

it("readonly settings keep their back header while disabling activation and relation choices", () => {
    for (const reason of ["disabled", "publish", "history"]) {
        const h = setup();
        h.protyle.disabled = reason === "disabled";
        h.siyuan.isPublish = reason === "publish";
        if (reason === "history") h.protyle.options.history = {created: "past"};
        const action = {disabled: false};
        const menu = {querySelectorAll: (selector: string) => {
            assert.equal(selector, "button:not([data-type=nobg])");
            return [action];
        }} as unknown as HTMLElement;
        h.api.bindSubItemsSettings(menu, h.protyle, h.block, {view: {columns: []}} as IAV, true);
        assert.equal(action.disabled, true);
        assert.equal(h.operations.length, 0);
    }
});

const settingsMenu = () => {
    let html = "initial";
    let enable = {disabled: false, onclick() {}};
    let mounted = true;
    const display = ["flat", "nested"].map(value => ({dataset: {subItemsDisplay: value}, onclick() {}}));
    let removed = 0;
    const menu = {
        get innerHTML() { return html; },
        get isConnected() { return mounted; },
        set innerHTML(value: string) { html = value; enable = {disabled: false, onclick() {}}; },
        contains: (button: unknown) => button === enable,
        querySelector: () => enable,
        querySelectorAll: (selector: string) => selector === "[data-sub-items-display]" ? display : [],
        closest: () => ({remove: () => { removed++; }}),
    };
    return {element: menu as unknown as HTMLElement, get enable() { return enable; }, display,
        get html() { return html; }, close: () => { mounted = false; }, removed: () => removed};
};
const flushSettings = () => new Promise(resolve => setImmediate(resolve));

it("keeps settings open and refreshes actual enabled state and display checks after each transaction", async () => {
    const h = setup();
    const menu = settingsMenu();
    const data = {id: "db", viewID: "view", viewType: "table", view: {columns: []},
        subItems: {enabled: false}, views: [{id: "view", subItemsDisplay: "flat"}]} as IAV;
    let resized = 0;
    h.api.bindSubItemsSettings(menu.element, h.protyle, h.block, data, false, () => { resized++; });
    menu.enable.onclick();
    assert.equal(menu.html, "initial");
    h.setResponse(async () => ({code: 0, data: {...data, subItems: {enabled: true},
        views: [{id: "view", subItemsDisplay: "nested"}]}}));
    h.callbacks.shift()();
    await flushSettings();
    assert.match(menu.html, /avDisableSubItems/);
    assert.match(menu.html, /data-sub-items-display="nested"[^]*?b3-menu__checked/);
    assert.equal(h.requests[0].path, "/api/av/renderAttributeView");
    assert.equal(JSON.stringify(h.requests[0].payload), JSON.stringify({id: "db", blockID: "carrier", viewID: "view", ignoreRows: true}));
    menu.display[0].onclick();
    h.setResponse(async () => ({code: 0, data: {...data, views: [{id: "view", subItemsDisplay: "flat"}]}}));
    h.callbacks.shift()();
    await flushSettings();
    assert.match(menu.html, /data-sub-items-display="flat"[^]*?b3-menu__checked/);
    menu.enable.onclick();
    h.setResponse(async () => ({code: 0, data: {...data, subItems: {enabled: false}}}));
    h.callbacks.shift()();
    await flushSettings();
    assert.match(menu.html, /avEnableSubItems/);
    assert.doesNotMatch(menu.html, /data-sub-items-display/);
    assert.equal(menu.removed(), 0);
    assert.equal(resized, 3);
});

it("ignores settings refreshes after closing, changing view or receiving a newer transaction", async () => {
    for (const reason of ["closed", "view", "newer", "readonly"]) {
        const h = setup();
        const menu = settingsMenu();
        const data = {id: "db", viewID: "view", viewType: "table", view: {columns: []}, subItems: {enabled: true}} as IAV;
        let finish: (value: unknown) => void;
        h.setResponse(() => new Promise(resolve => { finish = resolve; }));
        h.api.bindSubItemsSettings(menu.element, h.protyle, h.block, data);
        menu.display[0].onclick();
        h.callbacks.shift()();
        if (reason === "closed") menu.close();
        if (reason === "view") h.block.getAttribute = () => "other-view";
        if (reason === "readonly") h.protyle.disabled = true;
        if (reason === "newer") menu.display[1].onclick();
        finish({code: 0, data});
        await flushSettings();
        assert.equal(menu.html, "initial");
        assert.equal(menu.removed(), 0);
    }
});

it("leaves the settings page intact when refreshing the committed state fails", async () => {
    const h = setup();
    const menu = settingsMenu();
    h.api.bindSubItemsSettings(menu.element, h.protyle, h.block, {id: "db", view: {columns: []}} as IAV);
    menu.enable.onclick();
    h.callbacks.shift()();
    await flushSettings();
    assert.equal(menu.html, "initial");
    assert.equal(menu.removed(), 0);
});

it("retains the existing selection when the kernel rejects a change and returns unchanged settings", async () => {
    const h = setup();
    const menu = settingsMenu();
    const data = {id: "db", viewID: "view", view: {columns: []}, subItems: {enabled: false}} as IAV;
    h.setResponse(async () => ({code: 0, data}));
    h.api.bindSubItemsSettings(menu.element, h.protyle, h.block, data);
    menu.enable.onclick();
    h.callbacks.shift()();
    await flushSettings();
    assert.equal(menu.html, "initial");
    assert.equal(menu.removed(), 0);
});
