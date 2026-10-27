import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DOMFixture} from "./testDOM";
import * as capabilities from "./capabilities";

const setup = () => {
    const api = {} as typeof import("./layout");
    const transactions: Array<{perform: IOperation[]; undo: IOperation[]}> = [];
    let calendarBindings = 0;
    const modules: Record<string, unknown> = {
        "./capabilities": capabilities,
        "./calendar/settings": {getCalendarSettingsHTML: () => "", bindCalendarSettings() { calendarBindings++; }},
        "./viewType": {isTableLikeView: (type: TAVView) => type === "table" || type === "list"},
        "../../wysiwyg/transaction": {transaction: (_protyle: IProtyle, perform: IOperation[], undo: IOperation[]) => {
            transactions.push({perform, undo});
        }},
        "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"}},
        "../../../util/setPosition": {setPosition() {}},
        "./gallery/style": {getCardWidth: () => 240, getCardAspectRatioValue: () => 1, getCardAspectRatioLabel: () => "1:1"},
        "./gallery/cardLayout": {CARD_LAYOUT_COMPACT: 1},
    };
    runInNewContext(transpileModule(readFileSync(join(__dirname, "layout.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports: api, require: (name: string) => modules[name] || {},
        window: {siyuan: {languages: {displayFieldName: "Display field names"}}}});
    return {api, transactions, getCalendarBindings: () => calendarBindings};
};

test("field name switches persist per view and restore previous values for calendar, gallery and kanban", () => {
    for (const type of ["calendar", "gallery", "kanban"] as const) {
        for (const previous of [undefined, false, true]) {
            const fixture = setup();
            const document = new DOMFixture();
            const menu = document.createElement("div");
            const block = document.createElement("div");
            block.setAttribute("data-av-id", "database");
            block.setAttribute("data-node-id", "carrier");
            block.innerHTML = '<div class="av__views"></div>';
            const view = {calendar: {displayFieldName: previous}, displayFieldName: previous, coverFrom: 0,
                fields: [] as IAVGallery["fields"], pageSize: 20};
            const data = {viewID: "selected-view", viewType: type, view} as unknown as IAV;
            menu.innerHTML = fixture.api.getLayoutHTML(data);
            const selector = '.b3-switch[data-type="toggle-gallery-name"]';
            const input = menu.querySelector(selector);
            assert.ok(input, type);
            assert.equal(input.hasAttribute("checked"), !!previous);
            fixture.api.bindLayoutEvent({data, protyle: {} as IProtyle, menuElement: menu as unknown as HTMLElement,
                blockElement: block as unknown as Element});
            (input as unknown as HTMLInputElement).checked = !previous;
            input.dispatch("change");
            assert.equal(fixture.transactions.length, 1);
            const {perform, undo} = fixture.transactions[0];
            for (const [operations, expected] of [[perform, !previous], [undo, !!previous]] as const) {
                assert.equal(operations.length, 1);
                assert.equal(operations[0].action, "setAttrViewDisplayFieldName");
                assert.equal(operations[0].data, expected);
                assert.equal(operations[0].viewID, "selected-view");
                assert.equal(operations[0].avID, "database");
                assert.equal(operations[0].blockID, "carrier");
            }
            assert.equal(type === "calendar" ? view.calendar.displayFieldName : view.displayFieldName, !previous);
            assert.equal(menu.querySelector(selector).hasAttribute("checked"), !previous);
            assert.equal(fixture.getCalendarBindings(), type === "calendar" ? 2 : 0);
        }
    }
});

test("table and list layouts keep their existing field name presentation", () => {
    const {api} = setup();
    for (const viewType of ["table", "list"] as const) {
        assert.doesNotMatch(api.getLayoutHTML({viewType, view: {}} as IAV), /toggle-gallery-name/);
    }
});
