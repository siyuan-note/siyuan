import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";
import * as dates from "./date";

test("calendar without a date field renders its setup instead of reading an absent undated cache", async () => {
    const range = {start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 8).getTime(), timeZone: "UTC"};
    const state = {anchor: range.start, mode: "month", rowLimit: 3};
    const complete = new Error("container rendered");
    let html = "";
    const exports = {} as typeof import("./render");
    const modules: Record<string, unknown> = {
        "./date": dates,
        "./state": {getCalendarState: () => state, getCalendarRequestRange: () => range},
        "./settings": {getCalendarSettingsHTML: () => "date-field-settings"},
        "../render": {genTabHeaderHTML: () => "view-switcher"},
        "../col": {getColNameByType: (type: string) => type},
        "../../../../util/escape": {escapeAttr: String, escapeHtml: String},
        "../../../../constants": {Constants: {ZWSP: ""}},
        "../container": {replaceAVContainer: (_block: unknown, value: string) => {
            html = value;
            throw complete;
        }},
    };
    runInNewContext(transpileModule(readFileSync(join(__dirname, "render.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {
        exports, require: (name: string) => modules[name] || {},
        window: {siyuan: {config: {lang: "en"}, languages: {calendarSelectDateField: "Select date field"}}},
        document: {activeElement: null},
    });
    await assert.rejects(exports.renderCalendar({querySelector: (): null => null, removeAttribute() {}} as unknown as HTMLElement,
        {options: {}} as IProtyle,
        {viewID: "calendar", view: {calendar: {}, columns: [], rows: [], calendarRange: range}} as unknown as IAV),
    error => error === complete);
    assert.match(html, /view-switcher/);
    assert.match(html, /Select date field/);
    assert.match(html, /date-field-settings/);
});
