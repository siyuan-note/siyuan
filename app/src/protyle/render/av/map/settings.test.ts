import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../../util/escape";
import * as state from "./state";

const setup = () => {
    const operations: Array<{perform: IOperation[]; undo: IOperation[]}> = [];
    const menus: Array<Array<{label: string; checked: boolean; click: () => void}>> = [];
    const languages = {mapLocationField: "Location", mapSelectLocationField: "Select field", mapMissingLocationField: "Missing field"};
    const methods = {} as typeof import("./settings");
    const context = {siyuan: {isPublish: false, languages}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/settings.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, window: context, require: (id: string) => ({
        "./state": state,
        "../../../../util/escape": escape,
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) =>
            operations.push({perform, undo})},
        "../../../../util/fetch": {fetchSyncPost: () => assert.fail("settings must not fetch services")},
        "../viewSettingMenu": {openViewSettingMenu() {}},
        "../../../../plugin/Menu": {Menu: class {
            items: Array<{label: string; checked: boolean; click: () => void}> = [];
            constructor() { menus.push(this.items); }
            addItem(item: {label: string; checked: boolean; click: () => void}) { this.items.push(item); }
        }},
    })[id] || {}});
    return {methods, operations, menus, context};
};

const data = () => ({id: "database", viewID: "map-view", view: {
    map: {locationKeyID: "missing-field"},
    columns: [{id: "location", type: "location", name: "<Location>"}, {id: "text", type: "text", name: "Text"}],
}}) as IAV;

const control = () => {
    const handlers: Record<string, (event?: {preventDefault: () => void; stopPropagation: () => void}) => void> = {};
    return {disabled: false, isConnected: true,
        addEventListener: (type: string, handler: typeof handlers[string]) => { handlers[type] = handler; }, handlers};
};

test("map settings expose only a field choice and preserve missing field IDs", () => {
    const {methods, operations} = setup();
    const view = data().view as IAVTable;
    const before = JSON.stringify(view);
    const html = methods.getMapSettingsHTML(view);
    assert.match(html, /Missing field/);
    assert.doesNotMatch(html, /serviceID|missing-field|showRecordList|checkbox|<select/);
    assert.equal((html.match(/data-map-setting=/g) || []).length, 1);
    assert.equal(JSON.stringify(view), before);
    assert.equal(operations.length, 0);
    view.map.locationKeyID = "location";
    assert.match(methods.getMapSettingsHTML(view), /&lt;Location>/);
});

test("map field selection uses an undoable transaction without changing cells", () => {
    const {methods, operations, menus} = setup();
    const field = control();
    let updated = 0;
    methods.bindMapSettings({data: data(), protyle: {options: {}} as IProtyle,
        blockElement: {getAttribute: () => "carrier"} as unknown as Element,
        menuElement: {querySelectorAll: () => [field]} as unknown as Element, onChange: () => updated++});
    field.handlers.click({preventDefault() {}, stopPropagation() {}});
    assert.equal(menus[0].filter(item => item.checked).length, 1);
    menus[0].find(item => item.checked).click();
    assert.equal(operations.length, 0);
    menus[0].find(item => item.label === "&lt;Location>").click();
    assert.equal(updated, 1);
    const perform = operations[0].perform[0];
    assert.equal(perform.action, "setAttrViewMap");
    assert.equal(perform.avID, "database");
    assert.equal(perform.viewID, "map-view");
    assert.equal(perform.blockID, "carrier");
    assert.equal(JSON.stringify(perform.data), JSON.stringify({locationKeyID: "location"}));
    assert.equal(JSON.stringify(operations[0].undo[0].data), JSON.stringify({locationKeyID: "missing-field"}));
});

test("readonly, history, and published maps cannot change settings", () => {
    for (const mode of ["disabled", "history", "published"]) {
        const {methods, operations, context} = setup();
        const field = control();
        context.siyuan.isPublish = mode === "published";
        methods.bindMapSettings({data: data(), protyle: {disabled: mode === "disabled",
            options: {history: mode === "history" ? {created: "version"} : undefined}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [field]} as unknown as Element});
        assert.equal(field.disabled, true);
        assert.equal(Object.keys(field.handlers).length, 0);
        assert.equal(operations.length, 0);
    }
});

test("a dismissed menu and a later readonly transition cannot change map fields", () => {
    const {methods, operations, menus} = setup();
    const field = control();
    const protyle = {options: {}} as IProtyle;
    methods.bindMapSettings({data: data(), protyle, blockElement: {} as Element,
        menuElement: {querySelectorAll: () => [field]} as unknown as Element});
    field.isConnected = false;
    field.handlers.click({preventDefault() {}, stopPropagation() {}});
    assert.equal(menus.length, 0);
    field.isConnected = true;
    field.handlers.click({preventDefault() {}, stopPropagation() {}});
    protyle.disabled = true;
    menus[0].find(item => item.label === "&lt;Location>").click();
    assert.equal(operations.length, 0);
});
