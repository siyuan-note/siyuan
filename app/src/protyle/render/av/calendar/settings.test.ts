import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const setup = () => {
    const transactions: Array<{do: IOperation[], undo: IOperation[]}> = [];
    const menus: Array<Array<{label: string; checked: boolean; click: () => void}>> = [];
    const exports = {};
    const window = {siyuan: {isPublish: false, languages: {}, config: {lang: "en"}}};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "settings.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {
        exports, window, Lute: {NewNodeID: () => "new-field"},
        require: (id: string) => ({
            "../../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) =>
                transactions.push({do: perform, undo})},
            "../../../../util/escape": {escapeAttr: (value: string) => value, escapeHtml: (value: string) => value},
            "../col": {getColNameByType: (type: string) => type},
            "../viewSettingMenu": {openViewSettingMenu: (menu: {open: () => void}) => menu.open()},
            "../../../../plugin/Menu": {Menu: class {
                items: Array<{label: string; checked: boolean; click: () => void}> = [];
                constructor() { menus.push(this.items); }
                addItem(item: {label: string; checked: boolean; click: () => void}) { this.items.push(item); }
                open() { return; }
            }},
        })[id],
    });
    return {methods: exports as typeof import("./settings"), transactions, window, menus};
};

const data = () => ({id: "database", viewID: "calendar-view", view: {
    calendar: {dateKeyID: "missing-field", colorKeyID: "color", weekStart: 1}, columns: [],
}}) as IAV;
const block = {dataset: {nodeId: "carrier"}, getAttribute: () => "carrier"} as unknown as HTMLElement;
const settingsOf = (operation: IOperation) => {
    if (operation.action !== "setAttrViewCalendar") {
        throw new Error(`unexpected action ${operation.action}`);
    }
    return operation.data;
};

test("calendar setup creates and binds a field only on request in one undoable transaction", () => {
    const {methods, transactions} = setup();
    const view = data();
    methods.getCalendarSettingsHTML(view.view as IAVTable);
    assert.equal(transactions.length, 0);
    for (const type of ["date", "created", "updated"] as const) {
        methods.addCalendarDateField({options: {}} as IProtyle, block, view, type);
        const current = transactions.at(-1);
        assert.deepEqual(Array.from(current.do, item => item.action), ["addAttrViewCol", "setAttrViewCalendar", "setAttrViewColHidden"]);
        assert.deepEqual(Array.from(current.undo, item => item.action), ["setAttrViewCalendar", "removeAttrViewCol"]);
        assert.equal(current.do[0].type, type);
        assert.equal(current.do[0].viewID, "calendar-view");
        assert.equal(settingsOf(current.do[1]).dateKeyID, "new-field");
        assert.equal(settingsOf(current.undo[0]).dateKeyID, "missing-field");
        assert.equal(current.do.some(item => item.action === "updateAttrViewCell"), false);
    }
});

test("calendar layout submenus filter choices, mark selection and preserve undo", () => {
    for (const key of ["dateKeyID", "colorKeyID", "weekStart"] as const) {
        const {methods, transactions, menus} = setup();
        const current = data();
        const view = current.view as IAVTable;
        view.calendar = {dateKeyID: "date", colorKeyID: "color", weekStart: 1};
        view.columns = [{id: "date", type: "date", name: "Date"}, {id: "created", type: "created", name: "Created"},
            {id: "updated", type: "updated", name: "Updated"}, {id: "color", type: "select", name: "Color"},
            {id: "text", type: "text", name: "Text"}] as IAVColumn[];
        assert.doesNotMatch(methods.getCalendarSettingsHTML(view, true), /<select/);
        let click: (event: {preventDefault: () => void; stopPropagation: () => void}) => void;
        let refreshed = 0;
        const button = {tagName: "BUTTON", dataset: {calendarSetting: key},
            getBoundingClientRect: () => ({left: 0, bottom: 28, height: 28}),
            addEventListener: (_name: string, handler: typeof click) => { click = handler; }};
        methods.bindCalendarSettings({protyle: {options: {}} as IProtyle, blockElement: block, data: current,
            menuElement: {querySelectorAll: () => [button]} as unknown as Element, onChange: () => { refreshed++; }});
        click({preventDefault() { return; }, stopPropagation() { return; }});
        const items = menus[0];
        assert.equal(items.length, key === "weekStart" ? 7 : key === "dateKeyID" ? 4 : 2);
        assert.equal(items.filter(item => item.checked).length, 1);
        items.find(item => item.checked).click();
        assert.equal(transactions.length, 0);
        items[0].click();
        assert.equal(transactions.length, 1);
        assert.equal(settingsOf(transactions[0].do[0])[key], key === "weekStart" ? 0 : "");
        assert.equal(settingsOf(transactions[0].undo[0])[key], key === "weekStart" ? 1 : key === "dateKeyID" ? "date" : "color");
        assert.equal(refreshed, 1);
    }
});

test("calendar settings and field creation remain read-only in publish and archived editors", () => {
    const {methods, transactions, window} = setup();
    for (const mode of ["disabled", "publish", "created", "snapshot"]) {
        const select = {disabled: false, addEventListener: () => assert.fail("read-only handler")};
        window.siyuan.isPublish = mode === "publish";
        const protyle = {disabled: mode === "disabled", options: {history: {[mode]: "archive"}}} as IProtyle;
        methods.bindCalendarSettings({protyle, blockElement: block, data: data(),
            menuElement: {querySelectorAll: () => [select]} as unknown as Element});
        assert.equal(select.disabled, true);
        methods.addCalendarDateField(protyle, block, data(), "date");
    }
    assert.equal(transactions.length, 0);
});

test("calendar binding changes preserve the previous invalid binding for undo", () => {
    const {methods, transactions} = setup();
    let change: () => void;
    const select = {dataset: {calendarSetting: "dateKeyID"}, value: "date-field",
        addEventListener: (_name: string, handler: () => void) => { change = handler; }};
    methods.bindCalendarSettings({protyle: {options: {}} as IProtyle, blockElement: block, data: data(),
        menuElement: {querySelectorAll: () => [select]} as unknown as Element});
    change();
    assert.equal(settingsOf(transactions[0].do[0]).dateKeyID, "date-field");
    assert.equal(settingsOf(transactions[0].undo[0]).dateKeyID, "missing-field");
    assert.equal(settingsOf(transactions[0].do[0]).colorKeyID, "color");
});

test("calendar row limits preserve old defaults, persist numeric choices and support undo", () => {
    const {methods, transactions, menus} = setup();
    const current = data();
    let click: (event: {preventDefault: () => void; stopPropagation: () => void}) => void;
    const button = {tagName: "BUTTON", dataset: {calendarSetting: "rowLimit"},
        addEventListener: (_name: string, handler: typeof click) => { click = handler; }};
    methods.bindCalendarSettings({protyle: {options: {}} as IProtyle, blockElement: block, data: current,
        menuElement: {querySelectorAll: () => [button]} as unknown as Element});
    click({preventDefault() { return; }, stopPropagation() { return; }});
    assert.deepEqual(Array.from(menus[0], item => item.checked), [true, false, false, false]);
    menus[0][0].click();
    assert.equal(transactions.length, 0);
    for (const [index, limit] of [3, 5, 10, -1].entries()) {
        if (index === 0) {
            continue;
        }
        menus[0][index].click();
        assert.equal(settingsOf(transactions.at(-1).do[0]).rowLimit, limit);
        assert.equal(settingsOf(transactions.at(-1).undo[0]).rowLimit, index === 1 ? undefined : [3, 5, 10, -1][index - 1]);
        assert.equal(settingsOf(transactions.at(-1).do[0]).dateKeyID, "missing-field");
    }
});
