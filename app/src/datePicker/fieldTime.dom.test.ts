import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("popup time drafts normalize on blur and commit while preserving constraints and composition", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries(["model", "yearInput", "field"].map(name => [name, join(__dirname, name + ".ts")])));
    const result = await runBrowserCase(async source => {
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const ok = (value: boolean, message: string) => { if (!value) { throw Error(message); } };
        const edit = (input: HTMLInputElement, value: string) => {
            input.value = value; input.dispatchEvent(new Event("input", {bubbles: true}));
        };
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        const host = document.createElement("div"); document.body.append(host);
        for (const type of ["time", "datetime-local"]) {
            const prefix = type === "time" ? "" : "2026-11-12T";
            const field = modules.field.createDateField(host, {type, value: prefix + "10:00", languages});
            const time = host.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder^="HH:mm"]');
            for (const [raw, expected] of [["000", "00:00"], ["945", "09:45"], ["0945", "09:45"], ["1234", "12:34"], ["2359", "23:59"]]) {
                edit(time, raw);
                ok(time.value === raw && field.validate(), "Typing keeps the draft while recognizing complete numeric time");
                ok(field.commit() === prefix + expected && time.value === expected, "Commit normalizes numeric time");
                edit(time, raw); time.dispatchEvent(new FocusEvent("blur"));
                ok(time.value === expected, "Blur displays normalized time");
            }
            for (const raw of ["1", "12", "2400", "1260", "9999", "12345"]) {
                edit(time, raw); time.dispatchEvent(new FocusEvent("blur"));
                ok(!field.validate() && field.commit() === undefined && time.value === raw, "Invalid and partial drafts remain unchanged");
            }
            edit(time, "945"); time.dispatchEvent(new CompositionEvent("compositionstart"));
            time.dispatchEvent(new FocusEvent("blur"));
            ok(!field.validate() && field.commit() === undefined && time.value === "945", "IME cannot normalize or commit an unfinished draft");
            time.dispatchEvent(new CompositionEvent("compositionend"));
            ok(field.commit() === prefix + "09:45", "Finishing composition restores commit");
            field.destroy();
            const constrained = modules.field.createDateField(host, {type, value: prefix + "10:00", languages,
                min: prefix + "10:00", max: prefix + "12:00", step: "1800"});
            const constrainedTime = host.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder^="HH:mm"]');
            for (const raw of ["945", "1234", "1045"]) {
                edit(constrainedTime, raw);
                ok(!constrained.validate() && constrained.commit() === undefined && constrainedTime.value === raw, "Normalized time still respects min, max and step");
            }
            edit(constrainedTime, "1030");
            ok(constrained.commit() === prefix + "10:30", "A matching numeric time obeys step constraints");
            constrained.destroy();
            const precise = modules.field.createDateField(host, {type, value: prefix + "10:00", step: "any", languages});
            const preciseTime = host.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder^="HH:mm"]');
            edit(preciseTime, "11:22:33.456");
            ok(precise.commit() === prefix + "11:22:33.456", "Explicit seconds and milliseconds are preserved");
            precise.destroy();
        }
        const calendar = modules.field.createDateField(host, {type: "datetime-local", value: "2026-11-12T10:00", languages});
        edit(host.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder^="HH:mm"]'), "945");
        host.querySelector<HTMLButtonElement>('[data-date="2026-11-13"]').click();
        ok(calendar.commit() === "2026-11-13T09:45", "Selecting another date preserves numeric time instead of resetting it");
        calendar.destroy(); host.remove();
        return "popup time cases passed";
    }, sources);
    assert.match(result, /popup time cases passed/);
});
