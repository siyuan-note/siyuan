import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const setup = () => {
    const operations: IOperation[] = [];
    const inserted: unknown[] = [];
    const module = {exports: {}};
    const languages = new Proxy({}, {get: (_value, key) => String(key)});
    const siyuan = {languages, isPublish: false};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "subItems.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {module, exports: module.exports, window: {siyuan},
        require: (id: string) => ({
            "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "view"}},
            "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, values: IOperation[]) => operations.push(...values)},
            "./view": {getFieldsByData: (data: IAV) => (data.view as IAVTable).columns},
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
    return {api: module.exports as typeof import("./subItems"), operations, inserted, block, protyle, siyuan};
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

it("configures an existing self-relation pair through checked choices without changing field identity", () => {
    const h = setup();
    const field = {dataset: {subItemsParentKey: "parent"}, setAttribute() {},
        querySelector: () => ({classList: {toggle() {}}}), onclick: (event: MouseEvent) => { assert.ok(event); }};
    const enabled = {disabled: true, onclick: () => {}};
    const menu = {querySelector: () => enabled,
        querySelectorAll: (selector: string) => selector === "[data-sub-items-parent-key]" ? [field] : [],
        closest: () => ({remove() {}})} as unknown as HTMLElement;
    const data = {id: "db", view: {columns: [{id: "parent", name: "Parent", type: "relation",
        relation: {avID: "db", isTwoWay: true, backKeyID: "children"}}]}} as IAV;
    const root = h.api.getSubItemsSettingsHTML(data);
    assert.match(root, /go-sub-items-existing/);
    assert.doesNotMatch(root, /data-sub-items-parent-key|avSubItemsNewFields/);
    const advanced = h.api.getSubItemsSettingsHTML(data, true);
    assert.match(advanced, /avSubItemsParentFieldTip/);
    assert.match(advanced, /data-type="go-sub-items"/);
    h.api.bindSubItemsSettings(menu, h.protyle, h.block, data, true);
    enabled.onclick();
    assert.equal(h.operations.length, 0);
    field.onclick({preventDefault() {}, stopPropagation() {}} as MouseEvent);
    assert.equal(enabled.disabled, false);
    enabled.onclick();
    const operation = h.operations[0];
    assert.equal(operation.action, "setAttrViewSubItems");
    if (operation.action === "setAttrViewSubItems") {
        assert.equal(operation.data.parentKeyID, "parent");
        assert.equal(operation.data.childrenKeyID, "children");
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
