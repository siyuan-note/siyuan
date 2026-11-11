import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("template preview normalizes datetime inputs without changing other overrides or saving", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries([
        ...["model", "yearInput", "field", "inline"].map(name => [name, join(__dirname, "../../../datePicker/", name + ".ts")]),
        ...["automationTemplateFunctions", "automationTemplate"].map(name => [name, join(__dirname, name + ".ts")]),
    ]));
    const result = await runBrowserCase(async source => {
        const ok = (value: boolean, message: string) => { if (!value) { throw Error(message); } };
        const tick = () => new Promise(resolve => setTimeout(resolve, 20));
        const requests: {path: string; data: any}[] = [];
        let saves = 0;
        const escape = (value: string) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
        const modules: Record<string, any> = {
            escape: {escapeAttr: escape, escapeHtml: escape},
            fetch: {fetchSyncPost: async (path: string, data: any) => {
                requests.push({path, data}); return {code: 0, data: {type: "text", text: {content: "preview"}}};
            }},
            capabilities: {hasAVCapability: () => true}, fieldValueEditor: {getSelectedOptionsHTML: () => ""},
            locationValue: {getAVLocationDisplayText: () => ""}, compatibility: {writeText() {}}, message: {showMessage() {}},
        };
        Object.assign(window, {siyuan: {languages: {invalid: "Invalid"}}});
        for (const name of ["model", "yearInput", "field", "inline", "automationTemplateFunctions", "automationTemplate"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const time = Date.parse("2026-11-11T01:35:27.123Z");
        const date = {content: time, isNotEmpty: true, isNotTime: false, hasEndDate: false};
        const range = {...date, hasEndDate: true, content2: time + 86400000, isNotEmpty2: true};
        const sourceData = {id: "source", keyValues: [
            {key: {id: "primary", type: "block", name: "Name"}, values: [{blockID: "row", type: "block", block: {content: "QA"}}]},
            ...[["datetime", "date", date], ["date", "date", {...date, isNotTime: true}], ["range", "date", range], ["text", "text", {content: "unchanged"}]].map(([id, type, data]) =>
                ({key: {id, type, name: id}, values: [{blockID: "row", type, [String(type)]: data}]})),
        ]};
        const original = JSON.stringify(sourceData);
        const host = document.createElement("div"); document.body.append(host);
        modules.automationTemplate.mountAutomationTemplate({host, source: sourceData, targetID: "target",
            field: {id: "output", type: "text"}, rule: {trigger: "changed", enabled: false, timeZone: "Asia/Shanghai"},
            value: {template: '.action{field "datetime"} .action{field "date"} .action{field "range"} .action{field "text"}'},
            save: () => saves++, onResize() {}});
        host.querySelector<HTMLDetailsElement>("details").open = true;
        const item = host.querySelector<HTMLSelectElement>("[data-template-item]");
        item.value = "row"; item.dispatchEvent(new Event("change"));
        const input = (id: string) => host.querySelector<HTMLInputElement>(`[data-template-input="${id}"]`);
        const trigger = host.querySelector<HTMLInputElement>("[data-template-time]");
        const button = host.querySelector<HTMLButtonElement>("[data-template-run]");
        ok(!trigger.value.includes("T") && trigger.value.includes(" "), "Trigger datetime initially uses natural display");
        ok(input("datetime").value === "2026-11-11 09:35", "Source timezone controls visible datetime");
        ok(input("date").value === "2026-11-11" && input("range").value === JSON.stringify(range) &&
            !input("range").dataset.datePickerType, "Date-only and range text stay distinct");
        const edit = (field: HTMLInputElement, value: string) => {
            field.value = value; field.dispatchEvent(new Event("input", {bubbles: true}));
        };
        for (const separator of ["T", " "]) {
            edit(trigger, `2026-11-12${separator}10:40`);
            edit(input("datetime"), `2026-11-13${separator}11:50`);
            edit(input("date"), "2026-11-14"); edit(input("range"), JSON.stringify(range)); edit(input("text"), "literal T and space");
            ok(requests.length === (separator === "T" ? 0 : 1), "Editing only invalidates preview");
            button.click(); await tick();
            const request = requests.at(-1);
            ok(request?.path === "/api/av/previewAttributeViewTemplate" && request.data.timeZone === "Asia/Shanghai" &&
                request.data.triggerTime === "2026-11-12T10:40" && request.data.inputs.datetime === "2026-11-13T11:50", "Preview datetime payload is canonical");
            ok(request.data.inputs.date === "2026-11-14" && request.data.inputs.range === JSON.stringify(range) &&
                request.data.inputs.text === "literal T and space", "Other overrides remain unchanged");
        }
        trigger.step = "any"; input("datetime").step = "any"; await tick();
        edit(trigger, "2026-11-12 10:40:21.123"); edit(input("datetime"), "2026-11-13 11:50:22.456");
        button.click(); await tick();
        ok(requests.at(-1).data.triggerTime.endsWith(":21.123") && requests.at(-1).data.inputs.datetime.endsWith(":22.456"), "Explicit precision is retained");
        const count = requests.length;
        input("datetime").dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        button.click(); await tick(); ok(requests.length === count, "IME preview blocked");
        input("datetime").dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        edit(input("datetime"), "2026-02-31 12:00"); button.click(); await tick();
        ok(requests.length === count && input("datetime").value === "2026-02-31 12:00", "Invalid preview blocked without clearing draft");
        edit(input("datetime"), "2026-11-13 11:50"); edit(trigger, "2026-02-31 12:00");
        button.click(); await tick();
        ok(requests.length === count && trigger.value === "2026-02-31 12:00", "Invalid trigger blocks preview without clearing draft");
        ok(saves === 0 && JSON.stringify(sourceData) === original, "Preview never saves or changes source data");
        host.remove(); await tick();
        return "preview date cases passed";
    }, sources);
    assert.match(result, /preview date cases passed/);
});
