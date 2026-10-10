import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../../../../util/escape";
import * as menuGroup from "../../../../menus/menuGroup";
import * as state from "./state";
import {DOMElement, DOMFixture, requireFixture} from "./testDOM";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const menuSource = compile("src/menus/Menu.ts");
const settingsSource = compile("src/protyle/render/av/map/settings.ts");

const data = () => ({id: "database", viewID: "map-view", view: {
    map: {locationKeyID: "missing-field"},
    columns: [{id: "location", type: "location", name: "<Location>"}, {id: "text", type: "text", name: "Text"}],
}}) as IAV;

const setup = (mobile = false) => {
    const document = new DOMFixture();
    const operations: Array<{perform: IOperation[]; undo: IOperation[]}> = [];
    const shown: DOMElement[] = [];
    const menus: Array<{items: IMenu[]; independent: boolean; position?: IPosition; element: DOMElement}> = [];
    let closed = 0;
    const context = {siyuan: {isPublish: false,
        languages: {mapLocationField: "Location", mapSelectLocationField: "Select field", mapMissingLocationField: "Missing field"},
        menus: {menu: {showSubMenu: (element: DOMElement) => shown.push(element), remove: () => { closed++; }}}}};
    const sharedMenu = {} as typeof import("../../../../menus/Menu");
    runInNewContext(menuSource, {exports: sharedMenu, document, window: context, require: requireFixture({
        "../protyle/util/compatibility": {updateHotkeyTip: (value: string) => value.replace(/⌘/g, "Ctrl+").replace(/↩/g, "Enter")},
        "../util/setPosition": {}, "../util/zIndex": {}, "./menuPosition": {}, "./menuGroup": menuGroup,
        "./sheetOpen": {}, "../protyle/util/hasClosest": {}, "../util/functions": {isMobile: () => mobile},
        "../constants": {}, "../layout/getTopBarHeight": {}, "../protyle/undo": {}, "../util/escape": escape,
        "./menuKeyboard": {}, "../plugin/EventBusCore": {}, "../mobile/util/keyboardToolbar": {},
        "../block/popoverLifecycle": {}, "../config/entryVisibility/runtime": {},
    })});
    const methods = {} as typeof import("./settings");
    runInNewContext(settingsSource, {exports: methods, document, window: context, require: requireFixture({
        "./state": state, "../../../../util/escape": escape,
        "../../../../util/functions": {isMobile: () => mobile},
        "../../../../menus/Menu": sharedMenu,
        "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) =>
            operations.push({perform, undo})},
        "../../../../plugin/Menu": {Menu: class {
            readonly entry: typeof menus[number];
            constructor(_id?: string, _close?: () => void, independent = false) {
                const element = document.createElement("div");
                document.body.append(element);
                this.entry = {items: [], independent, element};
                menus.push(this.entry);
            }
            addItem(item: IMenu) {
                this.entry.items.push(item);
                this.entry.element.append(new sharedMenu.MenuItem(item).element as unknown as DOMElement);
            }
            open(position: IPosition) { this.entry.position = position; }
        }},
    })});
    const mount = (database = data(), protyle = {options: {}} as IProtyle) => {
        const menuElement = document.createElement("div");
        menuElement.innerHTML = methods.getMapSettingsHTML(database.view as IAVTable) +
            '<button class="b3-menu__item" data-other>Other setting</button>';
        document.body.append(menuElement);
        const blockElement = document.createElement("div");
        blockElement.dataset.nodeId = "carrier";
        let updated = 0;
        methods.bindMapSettings({data: database, protyle, menuElement: menuElement as unknown as Element,
            blockElement: blockElement as unknown as Element, onChange: () => { updated++; }});
        const field = menuElement.querySelector('[data-map-setting="locationKeyID"]');
        return {database, protyle, field, menuElement, updated: () => updated,
            choices: () => field.querySelector(".b3-menu__submenu").querySelectorAll("button")};
    };
    return {methods, document, operations, shown, menus, context, mount, closed: () => closed};
};

test("map settings mount a shared submenu, preserve missing field IDs and escape field labels", () => {
    const scenario = setup();
    const database = data();
    const view = database.view as IAVTable;
    const before = JSON.stringify(view);
    const {field, choices} = scenario.mount(database);
    assert.equal(field.querySelector(".av__map-setting-value").textContent, "Missing field");
    assert.equal(choices().length, 2);
    assert.equal(choices()[0].querySelector(".b3-menu__label").textContent, "<Location>");
    assert.equal(choices()[0].querySelector("location"), null);
    assert.equal(choices()[1].querySelectorAll(".b3-menu__checked").length, 1);
    assert.equal(field.querySelectorAll("select").length, 0);
    assert.equal(JSON.stringify(view), before);
    assert.equal(scenario.operations.length, 0);
    assert.equal(scenario.menus.length, 0);
});

test("empty field labels and absent choices still produce a usable settings item", () => {
    for (const mode of ["empty-label", "no-fields"]) {
        const scenario = setup();
        const database = data();
        const view = database.view as IAVTable;
        view.map.locationKeyID = "";
        if (mode === "no-fields") view.columns = [];
        else view.columns[0].name = "";
        const {field, choices} = scenario.mount(database);
        assert.equal(field.querySelector(".av__map-setting-value").getAttribute("title"), mode === "no-fields" ? "Select field" : "");
        assert.equal(choices().length, 1);
        field.dispatch("click");
        assert.equal(scenario.shown.length, 1);
    }
});

test("field names containing shortcut symbols remain literal labels", () => {
    const scenario = setup();
    const database = data();
    const view = database.view as IAVTable;
    view.map.locationKeyID = "location";
    view.columns[0].name = "⌘Office ↩ <Location>";
    const {field, choices} = scenario.mount(database);
    assert.equal(field.querySelector(".av__map-setting-value").textContent, view.columns[0].name);
    assert.equal(field.querySelector(".av__map-setting-value").getAttribute("title"), view.columns[0].name);
    assert.equal(choices()[0].querySelector(".b3-menu__label").textContent, view.columns[0].name);
});

test("desktop hover, sibling hover, ArrowRight, ArrowLeft and Escape use the actual submenu", () => {
    const scenario = setup();
    const {field, choices, menuElement} = scenario.mount();
    const submenu = field.querySelector(".b3-menu__submenu");
    field.dispatch("mouseenter", {bubbles: false});
    assert.equal(field.classList.contains("b3-menu__item--show"), true);
    assert.equal(scenario.shown[0], submenu);
    choices()[0].dispatch("mouseover");
    assert.equal(field.classList.contains("b3-menu__item--show"), true);
    menuElement.querySelector("[data-other]").dispatch("mouseover");
    assert.equal(field.classList.contains("b3-menu__item--show"), false);
    for (const key of ["ArrowLeft", "Escape"]) {
        const right = field.dispatch("keydown", {key: "ArrowRight"});
        assert.equal(right.defaultPrevented, true);
        assert.equal(scenario.document.activeElement, choices()[0]);
        assert.equal(field.classList.contains("b3-menu__item--show"), true);
        const close = choices()[0].dispatch("keydown", {key});
        assert.equal(close.defaultPrevented, true);
        assert.equal(scenario.document.activeElement, field);
        assert.equal(field.classList.contains("b3-menu__item--show"), false);
    }
    field.dispatch("click");
    assert.equal(field.classList.contains("b3-menu__item--show"), true);
    assert.equal(scenario.menus.length, 0);
    assert.equal(scenario.operations.length, 0);
});

test("map field selection uses the shared item click and an undoable transaction", () => {
    const scenario = setup();
    const {choices, updated} = scenario.mount();
    choices()[1].dispatch("click");
    assert.equal(scenario.operations.length, 0);
    choices()[0].dispatch("click");
    assert.equal(updated(), 1);
    assert.equal(scenario.closed(), 2);
    assert.deepEqual(JSON.parse(JSON.stringify(scenario.operations[0])), {
        perform: [{action: "setAttrViewMap", avID: "database", viewID: "map-view", blockID: "carrier", data: {locationKeyID: "location"}}],
        undo: [{action: "setAttrViewMap", avID: "database", viewID: "map-view", blockID: "carrier", data: {locationKeyID: "missing-field"}}],
    });
});

test("automatic defaults remain read only until selected and preserve raw-state undo", () => {
    for (const selectSecond of [false, true]) {
        const scenario = setup();
        const database = data();
        const view = database.view as IAVTable;
        view.map.locationKeyID = "";
        view.columns.push({id: "second", type: "location", name: "Second"});
        const before = JSON.stringify(view);
        const {field, choices} = scenario.mount(database);
        assert.equal(field.querySelector(".av__map-setting-value").textContent, "<Location>");
        assert.ok(choices()[0].querySelector(".b3-menu__checked"));
        assert.equal(scenario.operations.length, 0);
        assert.equal(JSON.stringify(view), before);
        choices()[selectSecond ? 1 : 0].dispatch("click");
        assert.equal(view.map.locationKeyID, selectSecond ? "second" : "location");
        assert.equal((scenario.operations[0].undo[0].data as IAVMapSettings).locationKeyID, "");
        view.map = {locationKeyID: ""};
        assert.equal(state.getMapSettings(view).locationKeyID, "location");
    }
});

test("mobile taps open an independent menu with checked choices and anchored ownership", () => {
    const scenario = setup(true);
    const {field, updated} = scenario.mount();
    field.dispatch("mouseenter", {bubbles: false});
    assert.equal(scenario.shown.length, 0);
    field.dispatch("click");
    assert.equal(scenario.menus.length, 1);
    const menu = scenario.menus[0];
    assert.equal(menu.independent, true);
    assert.equal(menu.position.target, field);
    assert.equal(menu.position.y, field.getBoundingClientRect().bottom);
    assert.equal(menu.items.filter(item => item.checked).length, 1);
    menu.element.querySelector("button").dispatch("click");
    assert.equal(updated(), 1);
    assert.equal(scenario.operations.length, 1);
});

test("readonly, both history modes and published maps cannot open field submenus", () => {
    for (const mode of ["disabled", "created", "snapshot", "published"]) {
        const scenario = setup();
        scenario.context.siyuan.isPublish = mode === "published";
        const {field} = scenario.mount(data(), {disabled: mode === "disabled",
            options: {history: ["created", "snapshot"].includes(mode) ? {[mode]: "version"} : undefined}} as IProtyle);
        assert.equal(field.disabled, true);
        assert.equal(field.querySelector(".b3-menu__submenu"), null);
        field.dispatch("click");
        assert.equal(scenario.operations.length, 0);
        assert.equal(scenario.shown.length, 0);
    }
});

test("dismissed controls and later readonly transitions cannot change fields", () => {
    for (const mobile of [false, true]) {
        for (const mode of ["dismissed", "readonly"]) {
            const scenario = setup(mobile);
            const {field, protyle, choices} = scenario.mount();
            field.dispatch("click");
            const choice = mobile ? scenario.menus[0].element.querySelector("button") : choices()[0];
            if (mode === "dismissed") field.remove();
            else protyle.disabled = true;
            field.dispatch("click");
            choice.dispatch("click");
            assert.equal(scenario.operations.length, 0);
            assert.equal(scenario.menus.length, mobile ? 1 : 0);
        }
    }
});
