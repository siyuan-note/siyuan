import * as capabilities from "./capabilities";
import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

test("numeric field editors accept decimal steps and preserve decimal and empty values", () => {
    const methods = loadModule<typeof import("./fieldValueEditor")>("src/protyle/render/av/fieldValueEditor.ts", {
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (name === "../../../util/escape" ? {escapeAttr: String} : {}),
    }, ScriptTarget.ES2022);
    const column = {type: "number"} as IAVColumn;
    for (const content of ["1.25", "-0.125", "1e-7", "0", ""]) {
        const value = methods.genFieldValue(column, {value: content} as unknown as HTMLElement);
        const html = methods.getValueInputHTML(column, {mode: "static", value});
        assert.match(html, /type="number" step="any"/);
        assert.equal(value.number.isNotEmpty, content !== "");
        assert.equal(value.number.content, Number(content));
        assert.match(html, new RegExp(`value="${content === "" ? "" : Number(content)}"`));
    }
});

test("template and fixed automation date fields bind inline without changing their stored value", () => {
    const bound: unknown[] = [];
    const methods = loadModule<typeof import("./fieldValueEditor")>("src/protyle/render/av/fieldValueEditor.ts", {
        require: (name: string) => name === "./capabilities" ? capabilities : ({
            "dayjs": require("dayjs"),
            "../../../util/escape": {escapeAttr: String},
            "../../../datePicker/inline": {bindInlineDatePicker: (_host: unknown, input: unknown) => {
                bound.push(input);
                return {validate: () => true, update() {}, destroy() {}};
            }},
        })[name] || {},
    });
    const values = ["2026-11-11", "2026-11-11T14:25"].map(value => ({
        value, closest: () => ({querySelector: () => ({})}),
    }));
    methods.bindFieldDates({querySelectorAll: (selector: string) => selector.startsWith("input") ? values : []} as unknown as HTMLElement);
    assert.deepEqual(bound, values);
    for (const [index, fillSpecificTime] of [false, true].entries()) {
        const column = {type: "date", date: {fillSpecificTime}} as IAVColumn;
        const stored = methods.genFieldValue(column, values[index] as unknown as HTMLElement);
        assert.equal(stored.date.isNotTime, !fillSpecificTime);
        assert.equal(stored.date.content, new Date(fillSpecificTime ? "2026-11-11T14:25:00" : "2026-11-11T00:00:00").getTime());
        const html = methods.getValueInputHTML(column, {mode: "currentTime", value: stored});
        assert.match(html, /fn__none/);
        assert.ok(html.includes(`type="${fillSpecificTime ? "datetime-local" : "date"}"`));
    }
});
