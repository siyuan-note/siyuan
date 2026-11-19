import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("template preview uses date dropdowns without changing other overrides or saving", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries([
        ...["model", "yearInput", "field", "inline", "runtime", "binding", "index"].map(name => [name, join(__dirname, "../../../datePicker/", name + ".ts")]),
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
            index: {}, panel: {registerDatePickerWindow() {}}, owners: {},
            overlayOwnership: {getMenuOwnerElement: (): HTMLElement | null => null},
            position: {bindDatePickerPosition: () => () => {}},
        };
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
        Object.assign(window, {siyuan: {languages}});
        for (const name of ["model", "yearInput", "field", "inline", "runtime", "binding", "index", "automationTemplateFunctions", "automationTemplate"]) {
            const exports = modules[name] ||= {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        modules.runtime.registerDatePickerRuntime(document, () => {
            const element = document.createElement("div");
            element.innerHTML = '<div class="b3-dialog__container" role="dialog"><div class="b3-dialog__body"></div></div>';
            document.body.append(element);
            return {element, destroy: () => element.remove()};
        }, () => languages);
        const popup = () => document.querySelector<HTMLElement>('[role="dialog"]')?.parentElement;
        const edit = (field: HTMLInputElement, value: string) => {
            field.value = value; field.dispatchEvent(new Event("input", {bubbles: true}));
        };
        const open = (input: HTMLInputElement) => {
            input.click();
            ok(input.getAttribute("aria-expanded") === "true" && !!popup(), "Click opens the date picker");
            return popup();
        };
        const confirm = async () => {
            popup().querySelector<HTMLButtonElement>('[data-action="confirm"]').click(); await tick();
        };
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
        ok(trigger.type === "datetime-local" && trigger.value.includes("T") && !host.querySelector(".date-picker"), "Preview calendars stay closed until requested");
        ok(input("datetime").value === "2026-11-11T09:35", "Source timezone controls the datetime");
        ok(input("date").value === "2026-11-11" && input("range").value === JSON.stringify(range) &&
            input("range").type === "text", "Date-only and range text stay distinct");
        ok(!input("range").hasAttribute("aria-haspopup") && input("date").getAttribute("aria-haspopup") === "dialog", "Only scalar date inputs bind dropdowns");
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
        for (const mobile of [false, true]) {
            const sidebar = document.createElement("div"); sidebar.id = "sidebar";
            if (mobile) { document.body.append(sidebar); }
            const root = open(input("datetime"));
            ok(root.classList.contains("date-picker-dialog") !== mobile, "Desktop uses an anchored dropdown and mobile uses a sheet");
            const dateDraft = root.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder="YYYY-MM-DD"]');
            const timeDraft = root.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder^="HH:mm"]');
            const apply = root.querySelector<HTMLButtonElement>('[data-action="confirm"]');
            const baseline = input("datetime").value;
            edit(dateDraft, "2026-02-31");
            ok(apply.disabled && dateDraft.value === "2026-02-31" && input("datetime").value === baseline, "Invalid popup drafts never overwrite preview values");
            edit(dateDraft, "2026-11-15");
            dateDraft.dispatchEvent(new CompositionEvent("compositionstart"));
            ok(apply.disabled, "IME composition cannot be committed");
            dateDraft.dispatchEvent(new CompositionEvent("compositionend"));
            edit(timeDraft, "945"); await confirm();
            ok(input("datetime").value === "2026-11-15T09:45" && !popup(), "Popup normalizes compact time and closes after confirmation");
            button.click(); await tick();
            ok(requests.at(-1).data.inputs.datetime === "2026-11-15T09:45", "Confirmed popup value becomes the override");
            const cancel = open(input("datetime"));
            edit(cancel.querySelector<HTMLInputElement>('.date-picker__fields input[placeholder="YYYY-MM-DD"]'), "2026-11-16");
            cancel.querySelector<HTMLButtonElement>('[data-action="cancel"]').click(); await tick();
            ok(input("datetime").value === "2026-11-15T09:45", "Cancel preserves the preview value");
            open(input("date"));
            popup().querySelector<HTMLButtonElement>('[data-date="2026-11-16"]').click(); await tick();
            if (mobile) {
                ok(!!popup() && input("date").value !== "2026-11-16", "Mobile day selection only changes the draft");
                await confirm();
            }
            ok(!popup() && input("date").value === "2026-11-16", "Date selection commits through the platform confirmation boundary");
            const previous = input("datetime"); open(previous);
            item.dispatchEvent(new Event("change")); await tick();
            ok(!popup() && !previous.isConnected && input("datetime").value === "2026-11-11T09:35", "Changing preview rows closes stale dropdowns and restores source data");
            sidebar.remove();
        }
        const count = requests.length;
        trigger.required = true; edit(trigger, "");
        button.click(); await tick();
        ok(requests.length === count, "Missing trigger time blocks preview");
        edit(trigger, "2026-11-12T10:40");
        input("datetime").min = "2026-11-12T00:00";
        button.click(); await tick();
        ok(requests.length === count, "Invalid native date constraints block preview");
        ok(saves === 0 && JSON.stringify(sourceData) === original, "Preview never saves or changes source data");
        open(trigger); host.remove(); await tick();
        ok(!popup(), "Removing the preview closes its dropdown");
        return "preview date cases passed";
    }, sources);
    assert.match(result, /preview date cases passed/);
});
