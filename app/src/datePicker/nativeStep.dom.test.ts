import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("date picker step parsing and precision agree with native input constraints", {timeout: 45000, skip: !canRunBrowser}, async () => {
    const sources = browserSources({model: join(__dirname, "model.ts"), field: join(__dirname, "field.ts")});
    const result = await runBrowserCase(async source => {
        const modules: Record<string, any> = {};
        for (const name of ["model", "field"]) {
            const exports = {};
            new Function("exports", "require", source[name])(exports, () => modules.model);
            modules[name] = exports;
        }
        let comparisons = 0;
        for (const type of ["date", "time", "datetime-local"]) {
            for (const step of ["", "any", "ANY", "AnY", "any ", "0", "-2", "0x10", "0b10", "+2", " 2", "2 ", "2.",
                "2foo", ".1", ".5", ".9", "1.1", "1.4", "1.5", "1.6", "2.5", "3.5", "2e0", "0.0001", "0.0004",
                "0.0005", "0.0007", "0.0011", "0.0014", "0.0015", "0.0016", "0.0025", "0.0035", "1e12", "1e308", "1e999"]) {
                for (const base of ["", "value", "min"]) {
                    const probe = document.createElement("input");
                    probe.type = type;
                    probe.step = step;
                    const anchor = type === "date" ? "1970-01-02" : type === "time" ? "00:00:00.001" : "1970-01-01T00:00:00.001";
                    const options: Record<string, string> = {type, step};
                    if (base === "min") { probe.min = anchor; options.min = anchor; }
                    if (base === "value") { probe.setAttribute("value", anchor); options.stepBase = anchor; }
                    const values = type === "date" ? ["", "0001-01-01", "1970-01-01", "1970-01-02", "1970-01-03", "1970-01-04", "1970-01-05"] :
                        ["", "00:00", "00:00:00.001", "00:00:00.002", "00:00:00.003", "00:00:00.004", "00:00:30", "12:00", "12:01"];
                    for (const raw of values) {
                        const value = type === "datetime-local" && raw ? "1970-01-01T" + raw : raw;
                        probe.value = value;
                        const valid = modules.model.validateDateValue(value, options) === "valid";
                        if (valid !== probe.validity.valid) {
                            throw new Error(JSON.stringify({type, step, base, value, expected: probe.validity.valid, actual: valid}));
                        }
                        comparisons++;
                    }
                }
            }
        }
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        for (const type of ["date", "time", "datetime-local"]) {
            const steps = ["0.5004999999999999", "0.50049999999999999", "0.5004999999999999999", "0.50050000000000001",
                "0.0024999999999999999999999999999", "1.49999999999999999", "1e-308", "1e-324", "1e-999"];
            if (type !== "date") {
                steps.push(...Array.from({length: 5000}, (_, value) => `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, "0")}5`));
            }
            for (const step of steps) {
                const probe = document.createElement("input"); probe.type = type; probe.step = step;
                probe.value = type === "date" ? "1970-01-01" : type === "time" ? "00:00" : "1970-01-01T00:00";
                probe.stepUp();
                if (modules.model.validateDateValue(probe.value, {type, step}) !== "valid") {
                    throw new Error("Native stepUp result must be valid: " + JSON.stringify({type, step, value: probe.value}));
                }
                if (type !== "date") {
                    const preceding = probe.valueAsNumber - 1;
                    probe.valueAsNumber = preceding;
                    if ((modules.model.validateDateValue(probe.value, {type, step}) === "valid") !== probe.validity.valid) {
                        throw new Error("Adjacent millisecond must match native validity: " + JSON.stringify({type, step, value: probe.value}));
                    }
                }
            }
        }
        for (const options of [{type: "time", value: "12:01", step: "0x10"},
            {type: "time", value: "12:00:00.001", step: "0.0007"},
            {type: "date", value: "1970-01-03", step: "1.5"},
            {type: "datetime-local", value: "2024-05-02T00:00:00.003", min: "2024-05-01T00:00:00.001", step: "0.0015"}]) {
            const host = document.createElement("div"); document.body.append(host);
            const field = modules.field.createDateField(host, {...options, languages});
            if (!field.validate()) { throw new Error("Native-valid field must remain confirmable: " + JSON.stringify(options)); }
            if (options.type !== "time") {
                const day = host.querySelector<HTMLButtonElement>('[data-date="' + options.value.split("T")[0] + '"]');
                if (day.getAttribute("aria-disabled") !== "false") { throw new Error("Native-valid day must remain selectable"); }
            }
            field.destroy(); host.remove();
        }
        for (const type of ["date", "datetime-local"]) {
            for (const date of ["0002024-02-28", "00000001-01-01", "000275760-09-13"]) {
                const value = date + (type === "datetime-local" ? "T00:00" : "");
                const native = document.createElement("input"); native.type = type; native.value = value;
                const host = document.createElement("div"); document.body.append(host);
                const field = modules.field.createDateField(host, {type, value, languages});
                if (!native.validity.valid || !field.validate() || field.commit() !== native.value) {
                    throw new Error("Native-valid long year must remain editable: " + value);
                }
                const canonical = modules.model.formatDate(modules.model.parseDate(date));
                const day = host.querySelector<HTMLButtonElement>('[data-date="' + canonical + '"]');
                if (day?.parentElement.getAttribute("aria-selected") !== "true") {
                    throw new Error("Long year must retain the selected calendar day: " + value);
                }
                field.destroy(); host.remove();
            }
        }
        return "Native step comparisons: " + comparisons;
    }, sources);
    assert.match(result, /Native step comparisons: 2775/);
});
