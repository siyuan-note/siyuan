import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as dates from "./date";

const stateExports = {};
const storage: Record<string, Record<string, string>> = {"local-av-calendar-modes": {}};
runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "state.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, {
    exports: stateExports,
    require: (id: string) => id === "./date" ? dates :
        {Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", LOCAL_AV_CALENDAR_MODES: "local-av-calendar-modes"}},
    window: {siyuan: {storage}},
});
const {getCalendarCreationDate, getCalendarRequestRange, getCalendarState, setCalendarMode} = stateExports as typeof import("./state");

const block = (viewID: string, type = "calendar", avID = "database") => ({getAttribute: (key: string) =>
    key === "data-av-type" ? type : key === "data-av-id" ? avID : viewID}) as unknown as Element;

test("calendar navigation is independent between editors and database views", () => {
    const first = block("view-a");
    const second = block("view-a");
    const state = getCalendarState(first);
    const secondAnchor = getCalendarState(second).anchor;
    state.anchor = new Date(2020, 0, 1).getTime();
    state.mode = "week";
    assert.equal(getCalendarState(first).anchor, state.anchor);
    assert.equal(getCalendarState(second).anchor, secondAnchor);
    assert.equal(getCalendarState(second).mode, "month");
    assert.equal(getCalendarState(first, "view-b").mode, "month");
});

test("calendar mode survives reopening without restoring the browsing date or changing other views", () => {
    const first = block("persisted-view");
    const state = getCalendarState(first);
    state.anchor = new Date(2020, 0, 1).getTime();
    assert.equal(setCalendarMode(first, "persisted-view", "week")["database:persisted-view"], "week");
    assert.equal(storage["local-av-calendar-modes"]["database:persisted-view"], "week");

    const reopened = block("persisted-view");
    assert.equal(getCalendarState(reopened).mode, "week");
    assert.equal(getCalendarState(reopened).anchor, dates.calendarDay(Date.now()));
    const range = getCalendarRequestRange(reopened);
    assert.equal(dates.calendarDayDistance(range.start, range.end), 7);
    assert.equal(getCalendarState(block("other-view")).mode, "month");
    assert.equal(getCalendarState(block("persisted-view", "calendar", "other-database")).mode, "month");

    setCalendarMode(reopened, "persisted-view", "month");
    assert.equal(storage["local-av-calendar-modes"]["database:persisted-view"], undefined);
    assert.equal(getCalendarState(block("persisted-view")).mode, "month");
});

test("only a calendar with an ordinary date source supplies the date of a new entry", () => {
    const calendar = block("view-a");
    const state = getCalendarState(calendar);
    for (const type of [undefined, "created", "updated"] as const) {
        state.dateType = type;
        assert.equal(getCalendarCreationDate(calendar), undefined);
    }
    state.dateType = "date";
    assert.equal(getCalendarCreationDate(calendar), state.anchor);
    const table = block("view-a", "table");
    getCalendarState(table).dateType = "date";
    assert.equal(getCalendarCreationDate(table), undefined);
});

test("calendar header creation supplies the browsing date with and without a template", () => {
    const action = ts.createSourceFile("action.ts", readFileSync(join(__dirname, "../action.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    let branch = "";
    const visit = (node: ts.Node) => {
        if (ts.isIfStatement(node) && node.expression.getText(action) === 'type === "av-add-more" && !protyle.disabled') {
            branch = node.thenStatement.getText(action);
        }
        ts.forEachChild(node, visit);
    };
    visit(action);
    assert.ok(branch);
    const template = ts.createSourceFile("newItemTemplate.ts",
        readFileSync(join(__dirname, "../newItemTemplate.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const create = template.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(template) === "createAttributeViewItem"));
    assert.ok(create);
    const compiled = ts.transpileModule(create.getText(template).replace(/^export /, "") + `\n(() => ${branch})();`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
    for (const layout of ["calendar", "table"]) {
        for (const templateID of ["", "template-id"]) {
            for (const dateType of ["date", "created", "updated"] as const) {
                const blockElement = {
                    dataset: {avId: "database", nodeId: "carrier"},
                    getAttribute: (key: string) => key === "data-av-type" ? layout : "view-id",
                    querySelector: () => ({dataset: {defaultTemplateId: templateID}}),
                } as unknown as HTMLElement;
                const state = getCalendarState(blockElement);
                state.anchor = new Date("2019-01-15T00:00:00").getTime();
                state.dateType = dateType;
                const requests: {calendarDate?: number, templateID: string, viewID: string}[] = [];
                let inserted = 0;
                runInNewContext(compiled, {
                    blockElement, getCalendarCreationDate,
                    Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
                    protyle: {app: {appId: "app"}, id: "editor"},
                    event: {preventDefault() {}, stopPropagation() {}},
                    fetchPost: (url: string, payload: typeof requests[number]) => {
                        assert.equal(url, "/api/av/createAttributeViewItem");
                        requests.push(payload);
                    },
                    insertRows: () => inserted++,
                });
                if (layout === "table" && !templateID) {
                    assert.equal(inserted, 1);
                    assert.equal(requests.length, 0);
                } else {
                    assert.equal(inserted, 0);
                    assert.equal(requests.length, 1);
                    assert.equal(requests[0].templateID, templateID);
                    assert.equal(requests[0].viewID, "view-id");
                    assert.equal(requests[0].calendarDate, layout === "calendar" && dateType === "date" ? state.anchor : undefined);
                }
            }
        }
    }
});
