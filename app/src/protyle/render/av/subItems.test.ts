import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const setup = () => {
    const operations: IOperation[] = [];
    const inserted: unknown[] = [];
    const menus: IMenu[][] = [];
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
            "../../../menus/menuToggle": {toggleMenu: (options: {target: Element; build: () => void; show: () => void}) => {
                assert.ok(options.target);
                options.build();
                options.show();
            }},
            "../../../plugin/Menu": {Menu: class {
                items: IMenu[] = [];
                constructor() { menus.push(this.items); }
                addItem(item: IMenu) { this.items.push(item); }
                open() {}
            }},
        }[id] || {}),
    });
    const block = {isConnected: true, dataset: {avId: "db", nodeId: "carrier"},
        hasAttribute: () => true, getAttribute: () => "view"} as unknown as HTMLElement;
    const protyle = {options: {}} as IProtyle;
    return {api: module.exports as typeof import("./subItems"), operations, inserted, menus, block, protyle, siyuan};
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
        assert.match(disabled, /data-sub-items-field/);
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
    const label = {textContent: ""};
    const listeners: Record<string, () => void> = {};
    const field = {dataset: {subItemsField: ""}, querySelector: () => label,
        addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; },
        getBoundingClientRect: () => ({right: 10, bottom: 20, height: 10}), onclick: () => {}};
    const enabled = {onclick: () => {}};
    const menu = {querySelector: (selector: string) => selector === "[data-sub-items-field]" ? field : enabled,
        querySelectorAll: (): HTMLElement[] => [], closest: () => ({remove() {}}), addEventListener() {}} as unknown as HTMLElement;
    const data = {id: "db", view: {columns: [{id: "parent", name: "Parent", type: "relation",
        relation: {avID: "db", isTwoWay: true, backKeyID: "children"}}]}} as IAV;
    h.api.bindSubItemsSettings(menu, h.protyle, h.block, data);
    listeners.mouseenter();
    assert.equal(h.menus[0][0].checked, true);
    h.menus[0][1].click(undefined, undefined);
    enabled.onclick();
    const operation = h.operations[0];
    assert.equal(operation.action, "setAttrViewSubItems");
    if (operation.action === "setAttrViewSubItems") {
        assert.equal(operation.data.parentKeyID, "parent");
        assert.equal(operation.data.childrenKeyID, "children");
    }
});
