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
    const opened: string[] = [];
    const languages = {mapService: "Service", mapLocationField: "Location", mapSelectService: "Select service",
        mapSelectLocationField: "Select field", mapShowRecordList: "Show records", mapConfigureServices: "Configure"};
    const methods = {} as typeof import("./settings");
    const context = {siyuan: {isPublish: false, languages}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/settings.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, window: context, require: (id: string) => ({
        "./state": state,
        "../../../../util/escape": escape,
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) =>
            operations.push({perform, undo})},
        "../../../../config": {openMapSettings: (_app: unknown, missing: string) => opened.push(missing)},
        "../../../../util/fetch": {fetchSyncPost: async () => ({code: 0, data: {services: [] as import("./settings").IMapServiceChoice[]}})},
        "../viewSettingMenu": {openViewSettingMenu() {}},
        "../../../../plugin/Menu": {Menu: class {
            items: Array<{label: string; checked: boolean; click: () => void}> = [];
            constructor() { menus.push(this.items); }
            addItem(item: {label: string; checked: boolean; click: () => void}) { this.items.push(item); }
        }},
    })[id] || {}});
    return {methods, operations, menus, opened, context};
};

const data = () => ({id: "database", viewID: "map-view", view: {
    map: {serviceID: "missing-service", locationKeyID: "missing-field", showRecordList: true},
    columns: [{id: "location", type: "location", name: "<Location>"}, {id: "text", type: "text", name: "Text"}],
}}) as IAV;

const control = (key: string, tagName = "BUTTON") => {
    const handlers: Record<string, (event?: {preventDefault: () => void; stopPropagation: () => void}) => void> = {};
    return {tagName, dataset: {mapSetting: key}, disabled: false, isConnected: true, value: "", checked: false,
        hasAttribute: (name: string) => name === "data-map-configure" && key === "configure",
        addEventListener: (type: string, handler: typeof handlers[string]) => { handlers[type] = handler; }, handlers};
};

test("map settings preserve missing IDs, escape labels, and never automatically select a service or field", () => {
    const {methods, operations} = setup();
    const current = data();
    const view = current.view as IAVTable;
    const before = JSON.stringify(view);
    const html = methods.getMapSettingsHTML(view, false, [{id: "service", name: "<Service>", provider: "openfreemap", configured: true}]);
    assert.match(html, /value="missing-service" selected/);
    assert.match(html, /value="missing-field" selected/);
    assert.match(html, /&lt;Service>/);
    assert.match(html, /&lt;Location>/);
    assert.doesNotMatch(html, /value="text"/);
    assert.doesNotMatch(methods.getMapSettingsHTML(view, true), /<select/);
    assert.equal(JSON.stringify(view), before);
    assert.equal(operations.length, 0);
});

test("map selection uses an undoable full-settings transaction without changing cells", async () => {
    const {methods, operations, menus} = setup();
    const current = data();
    const field = control("locationKeyID");
    let updated = 0;
    methods.bindMapSettings({data: current, protyle: {options: {}} as IProtyle,
        blockElement: {getAttribute: () => "carrier"} as unknown as Element,
        menuElement: {querySelectorAll: () => [field]} as unknown as Element,
        services: [], onChange: () => updated++});
    await field.handlers.click({preventDefault() {}, stopPropagation() {}});
    assert.equal(menus[0].filter(item => item.checked).length, 1);
    menus[0].find(item => item.checked).click();
    assert.equal(operations.length, 0);
    menus[0].find(item => item.label === "&lt;Location>").click();
    assert.equal(updated, 1);
    const perform = operations[0].perform[0];
    const undo = operations[0].undo[0];
    assert.equal(perform.action, "setAttrViewMap");
    assert.equal(perform.avID, "database");
    assert.equal(perform.viewID, "map-view");
    assert.equal(perform.blockID, "carrier");
    assert.equal(JSON.stringify(perform.data), JSON.stringify({serviceID: "missing-service", locationKeyID: "location", showRecordList: true}));
    assert.equal(JSON.stringify(undo.data), JSON.stringify({serviceID: "missing-service", locationKeyID: "missing-field", showRecordList: true}));
});

test("readonly, history, and published maps cannot change settings or open configuration", () => {
    for (const mode of ["disabled", "history", "published"]) {
        const {methods, operations, opened, context} = setup();
        const field = control("serviceID");
        const configure = control("configure");
        context.siyuan.isPublish = mode === "published";
        methods.bindMapSettings({data: data(), protyle: {disabled: mode === "disabled",
            options: {history: mode === "history" ? {created: "version"} : undefined}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [field, configure]} as unknown as Element});
        assert.equal(field.disabled, true);
        assert.equal(configure.disabled, true);
        assert.equal(Object.keys(field.handlers).length, 0);
        assert.equal(operations.length, 0);
        assert.equal(opened.length, 0);
    }
});

test("map configuration forwards the preserved missing service ID for explicit device-local setup", () => {
    const {methods, opened} = setup();
    const configure = control("configure");
    methods.bindMapSettings({data: data(), protyle: {options: {}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [configure]} as unknown as Element,
        services: []});
    configure.handlers.click();
    assert.deepEqual(opened, ["missing-service"]);
});
