import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../../util/escape";
import * as state from "./state";

const setup = (loadServices: () => Promise<import("./settings").IMapServiceChoice[]> = async () => []) => {
    const operations: Array<{perform: IOperation[]; undo: IOperation[]}> = [];
    const menus: Array<Array<{label: string; checked: boolean; click: () => void}>> = [];
    const requests: string[] = [];
    const languages = {mapService: "Service", mapLocationField: "Location", mapSelectService: "Select service",
        mapSelectLocationField: "Select field", mapMissingService: "Missing service",
        mapMissingLocationField: "Missing field", loading: "Loading"};
    const methods = {} as typeof import("./settings");
    const context = {siyuan: {isPublish: false, languages}};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/map/settings.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: methods, window: context, require: (id: string) => ({
        "./state": state,
        "../../../../util/escape": escape,
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) =>
            operations.push({perform, undo})},
        "../../../../util/fetch": {fetchSyncPost: async (url: string) => {
            requests.push(url);
            return {code: 0, data: {services: await loadServices()}};
        }},
        "../viewSettingMenu": {openViewSettingMenu() {}},
        "../../../../plugin/Menu": {Menu: class {
            items: Array<{label: string; checked: boolean; click: () => void}> = [];
            constructor() { menus.push(this.items); }
            addItem(item: {label: string; checked: boolean; click: () => void}) { this.items.push(item); }
        }},
    })[id] || {}});
    return {methods, operations, menus, requests, context};
};

const data = () => ({id: "database", viewID: "map-view", view: {
    map: {serviceID: "missing-service", locationKeyID: "missing-field", showRecordList: true},
    columns: [{id: "location", type: "location", name: "<Location>"}, {id: "text", type: "text", name: "Text"}],
}}) as IAV;

const control = (key: string) => {
    const handlers: Record<string, (event?: {preventDefault: () => void; stopPropagation: () => void}) => void> = {};
    const label = {textContent: "", title: ""};
    return {tagName: "BUTTON", dataset: {mapSetting: key}, disabled: false, isConnected: true,
        label, querySelector: () => label,
        addEventListener: (type: string, handler: typeof handlers[string]) => { handlers[type] = handler; }, handlers};
};

test("map settings preserve missing IDs, escape labels, and never automatically select a service or field", () => {
    const {methods, operations} = setup();
    const current = data();
    const view = current.view as IAVTable;
    const before = JSON.stringify(view);
    const html = methods.getMapSettingsHTML(view, []);
    assert.match(html, /Missing service/);
    assert.match(html, /Missing field/);
    const pendingHTML = methods.getMapSettingsHTML(view);
    assert.match(pendingHTML, /Loading/);
    for (const settingsHTML of [html, pendingHTML]) {
        assert.doesNotMatch(settingsHTML, /missing-service|missing-field|showRecordList|data-map-configure|checkbox|<select/);
        assert.equal((settingsHTML.match(/data-map-setting=/g) || []).length, 2);
    }
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

test("readonly, history, and published maps cannot change settings", () => {
    for (const mode of ["disabled", "history", "published"]) {
        const {methods, operations, requests, context} = setup();
        const field = control("serviceID");
        context.siyuan.isPublish = mode === "published";
        methods.bindMapSettings({data: data(), protyle: {disabled: mode === "disabled",
            options: {history: mode === "history" ? {created: "version"} : undefined}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [field]} as unknown as Element});
        assert.equal(field.disabled, true);
        assert.equal(Object.keys(field.handlers).length, 0);
        assert.equal(operations.length, 0);
        assert.deepEqual(requests, mode === "disabled" ? ["/api/map/getConf"] : []);
    }
});

test("map menus resolve service names before interaction and retain IDs only for transactions", async () => {
    const serviceID = "19082d45-0536-457f-a57e-8c1ea5222222";
    const choices = [{id: serviceID, name: "<OFM>", provider: "openfreemap" as const, configured: true}];
    const {methods, requests, menus} = setup(async () => choices);
    const current = data();
    const view = current.view as IAVTable;
    view.map.serviceID = serviceID;
    view.map.locationKeyID = "location";
    const html = methods.getMapSettingsHTML(view, choices);
    assert.match(html, /&lt;OFM>/);
    assert.match(html, /&lt;Location>/);
    assert.match(html, /fn__ellipsis av__map-setting-value/);
    assert.doesNotMatch(html, new RegExp(serviceID));
    const service = control("serviceID");
    methods.bindMapSettings({data: current, protyle: {options: {}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [service]} as unknown as Element});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.label.textContent, "<OFM>");
    assert.equal(service.label.title, "<OFM>");
    await service.handlers.click({preventDefault() {}, stopPropagation() {}});
    assert.deepEqual(requests, ["/api/map/getConf"]);
    assert.equal(menus[0].find(item => item.checked).label, "&lt;OFM>");
    assert.equal(view.map.serviceID, serviceID);
});

test("late map service responses cannot update a dismissed menu", async () => {
    let respond: (services: import("./settings").IMapServiceChoice[]) => void;
    const {methods} = setup(() => new Promise(resolve => { respond = resolve; }));
    const service = control("serviceID");
    methods.bindMapSettings({data: data(), protyle: {options: {}} as IProtyle,
        blockElement: {} as Element, menuElement: {querySelectorAll: () => [service]} as unknown as Element});
    service.isConnected = false;
    respond([]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.label.textContent, "");
});
