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

test("template and fixed automation date fields use dropdowns without changing their stored value", () => {
    const bound: unknown[] = [];
    let open = false;
    let destroyed = 0;
    const methods = loadModule<typeof import("./fieldValueEditor")>("src/protyle/render/av/fieldValueEditor.ts", {
        require: (name: string) => name === "./capabilities" ? capabilities : ({
            "dayjs": require("dayjs"),
            "../../../util/escape": {escapeAttr: String},
            "../../../datePicker/inline": {getInlineDateValue: (input: {value: string}) => input.value.replace(" ", "T")},
            "../../../datePicker/binding": {bindDatePicker: (input: unknown) => {
                bound.push(input);
                return {isOpen: () => open, destroy() { destroyed++; }};
            }},
        })[name] || {},
    });
    const values = ["2026-11-11", "2026-11-11T14:25"].map(value => ({
        value, hidden: false, valid: true,
        closest() { return this.hidden ? {} : null; },
        checkValidity() { return this.valid; },
    }));
    const doc = {activeElement: undefined as unknown, removeEventListener() {}};
    const binding = methods.bindFieldDates({ownerDocument: doc,
        querySelectorAll: (selector: string) => selector.startsWith("input") ? values : []} as unknown as HTMLElement);
    assert.deepEqual(bound, values);
    assert.equal(binding.validate(), true);
    assert.equal(binding.isActive(), false);
    open = true;
    assert.equal(binding.isActive(), true, "The popup keeps automation blur from saving an unfinished selection");
    open = false;
    doc.activeElement = values[0];
    assert.equal(binding.isActive(), true);
    doc.activeElement = undefined;
    values[0].valid = false;
    assert.equal(binding.validate(), false);
    assert.equal(binding.submit(), false);
    values[0].hidden = true;
    assert.equal(binding.submit(), true, "Current-time mode ignores the hidden static date");
    for (const [index, fillSpecificTime] of [false, true].entries()) {
        const column = {type: "date", date: {fillSpecificTime}} as IAVColumn;
        const stored = methods.genFieldValue(column, values[index] as unknown as HTMLElement);
        assert.equal(stored.date.isNotTime, !fillSpecificTime);
        assert.equal(stored.date.content, new Date(fillSpecificTime ? "2026-11-11T14:25:00" : "2026-11-11T00:00:00").getTime());
        const html = methods.getValueInputHTML(column, {mode: "currentTime", value: stored});
        assert.match(html, /fn__none/);
        assert.ok(html.includes(`type="${fillSpecificTime ? "datetime-local" : "date"}"`));
        assert.doesNotMatch(html, /data-field-date-picker/);
    }
    binding.destroy();
    binding.destroy();
    assert.equal(destroyed, 2, "Each dropdown binding is disposed exactly once");
    assert.equal(binding.validate(), false);
});
