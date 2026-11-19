import * as assert from "node:assert/strict";
import {join} from "node:path";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";
import * as capabilities from "./capabilities";

const setup = () => {
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
    const api = loadModule<typeof import("./layout")>(join(__dirname, "layout.ts"), {
        require: (name: string) => modules[name] || {},
        window: {siyuan: {languages: {displayFieldName: "Display field names"}}},
    }, ScriptTarget.ES2022);
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

test("all layouts toggle primary and related item icons independently with undo and repeated changes", () => {
    for (const viewType of ["table", "list", "gallery", "kanban", "calendar"] as const) {
        for (const previous of [false, true]) {
            for (const related of [undefined, false, true]) {
                const fixture = setup();
                const document = new DOMFixture();
                const menu = document.createElement("div");
                const block = document.createElement("div");
                block.setAttribute("data-av-id", "database");
                block.setAttribute("data-node-id", "carrier");
                block.innerHTML = '<div class="av__views"></div>';
                const view = {showIcon: previous, showRelationIcon: related, calendar: {}, fields: [] as IAVGallery["fields"], columns: [] as IAVTable["columns"], pageSize: 20};
                const data = {viewID: "view", viewType, view} as unknown as IAV;
                menu.innerHTML = fixture.api.getLayoutHTML(data);
                const primary = menu.querySelector('[data-type="toggle-entries-icons"]');
                const relation = menu.querySelector('[data-type="toggle-relation-icons"]');
                assert.equal(primary.hasAttribute("checked"), previous);
                assert.equal(relation.hasAttribute("checked"), related ?? previous);
                fixture.api.bindLayoutEvent({data, protyle: {} as IProtyle, menuElement: menu as unknown as HTMLElement,
                    blockElement: block as unknown as Element});
                for (const next of [!previous, previous]) {
                    (primary as unknown as HTMLInputElement).checked = next;
                    primary.dispatch("change");
                    const current = fixture.transactions.at(-1);
                    assert.equal(current.perform[0].action, "setAttrViewShowIcon");
                    assert.equal(current.perform[0].data, next);
                    assert.equal(current.undo[0].data, !next);
                    assert.equal(view.showIcon, next);
                    assert.equal(view.showRelationIcon, related ?? previous);
                }
                for (const next of [!(related ?? previous), related ?? previous]) {
                    (relation as unknown as HTMLInputElement).checked = next;
                    relation.dispatch("change");
                    const current = fixture.transactions.at(-1);
                    assert.equal(current.perform[0].action, "setAttrViewShowRelationIcon");
                    assert.equal(current.perform[0].data, next);
                    assert.equal(current.undo[0].data, !next);
                    assert.equal(current.perform[0].viewID, "view");
                    assert.equal(current.perform[0].avID, "database");
                    assert.equal(view.showIcon, previous);
                    assert.equal(view.showRelationIcon, next);
                }
            }
        }
    }
});
