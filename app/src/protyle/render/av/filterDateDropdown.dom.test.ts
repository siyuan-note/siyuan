import * as assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("desktop filter dropdowns do not save on open or cancel and survive condition redraw", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries([
        ["model", "../../../datePicker/model.ts"], ["yearInput", "../../../datePicker/yearInput.ts"],
        ["field", "../../../datePicker/field.ts"], ["inline", "../../../datePicker/inline.ts"],
        ["capabilities.generated", "capabilities.generated.ts"],
        ["capabilities", "capabilities.ts"], ["filterTree", "filterTree.ts"],
        ["filterDateDropdown", "filterDateDropdown.ts"], ["filter", "filter.ts"],
    ].map(([name, path]) => [name, join(__dirname, path)])));
    const result = await runBrowserCase(async source => {
        const equal = (a: unknown, b: unknown) => { if (a !== b) { throw Error(`${a} !== ${b}`); } };
        window.siyuan = {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {},
            menus: {menu: {remove() {}}}} as any;
        const modules: Record<string, any> = {};
        let saves = 0;
        let rejectSave = false;
        let deferSaves = false;
        const pendingSaves: Array<{resolve(): void; reject(error: Error): void}> = [];
        let opened = 0;
        let finish: (value: any) => void;
        const stubs: Record<string, any> = {
            "../../../util/functions": {isMobile: () => false},
            "./view": {getFieldsByData: (data: any) => data.view.columns},
            "./col": {getColIconByType: () => "iconCalendar"},
            "../../../util/escape": {escapeHtml: String, escapeAttr: String},
            "../../../dialog/message": {showMessage() {}},
            dayjs: {default: (value: number) => ({isValid: () => Number.isFinite(value),
                format: () => new Date(value).toISOString().slice(0, 10)})},
            "../../../datePicker": {openInternalDatePicker: () => {
                opened++;
                const button = document.createElement("button"); document.body.append(button); button.focus();
                const result = new Promise(resolve => { finish = value => { button.remove(); resolve(value); }; });
                return {result, destroy: () => finish({type: "cancel"})};
            }},
        };
        for (const name of Object.keys(source)) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) =>
                stubs[path] || modules[path.split("/").at(-1)] || {});
        }
        const root = document.createElement("div"); document.body.append(root);
        const data = {view: {columns: [{id: "date", type: "date", name: "Date"}],
            filters: [{column: "date", operator: "Is equal", value: {type: "date"}}]}};
        const render = () => modules.filter.getFiltersHTML(data, true);
        root.innerHTML = render();
        modules.filter.bindInlineFilterEvents(root, data, {}, "carrier", "database",
            {root, render, save: () => {
                saves++;
                if (deferSaves) {
                    return new Promise<void>((resolve, reject) => pendingSaves.push({resolve, reject}));
                }
                if (rejectSave) { return Promise.reject(new Error("Save failed")); }
            }});
        const input = () => root.querySelector<HTMLInputElement>('[data-type="absDate"]');
        const open = () => input().dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
        open(); equal(opened, 1); equal(saves, 0);
        input().dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0}));
        equal(opened, 1);
        equal(root.querySelectorAll(".date-picker--inline").length, 0);
        finish({type: "cancel"}); await Promise.resolve(); equal(saves, 0);
        input().value = "2026-11-12";
        open(); equal(saves, 0);
        finish({type: "confirm", value: "2026-11-13"}); await Promise.resolve(); equal(saves, 1);
        const mode = root.querySelector<HTMLSelectElement>('[data-type="dateType"]');
        mode.value = "custom"; mode.dispatchEvent(new Event("change", {bubbles: true}));
        const nextMode = root.querySelector<HTMLSelectElement>('[data-type="dateType"]');
        nextMode.value = "time"; nextMode.dispatchEvent(new Event("change", {bubbles: true}));
        const before = saves;
        open(); equal(opened, 3); equal(saves, before);
        finish({type: "cancel"}); await Promise.resolve(); equal(saves, before);
        input().dispatchEvent(new MouseEvent("click", {bubbles: true, button: 0, detail: 0}));
        equal(opened, 4); equal(saves, before);
        finish({type: "cancel"}); await Promise.resolve(); equal(saves, before);
        rejectSave = true;
        input().focus();
        input().value = "2026-11-20";
        input().dispatchEvent(new Event("change", {bubbles: true}));
        await Promise.resolve(); await Promise.resolve();
        equal(saves, before + 1);
        equal((data.view.filters[0].value as any).date.content, new Date("2026-11-20T00:00:00").getTime());
        input().dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input().dispatchEvent(new FocusEvent("blur"));
        await Promise.resolve(); await Promise.resolve();
        equal(saves, before + 2);
        rejectSave = false;
        input().dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input().dispatchEvent(new FocusEvent("blur"));
        equal(saves, before + 3);
        deferSaves = true;
        const change = (value: string) => {
            input().value = value;
            input().dispatchEvent(new Event("change", {bubbles: true}));
        };
        change("2026-11-21"); change("2026-11-22");
        pendingSaves[1].resolve(); await Promise.resolve();
        pendingSaves[0].reject(new Error("Older save failed")); await Promise.resolve(); await Promise.resolve();
        const afterSuccess = saves;
        input().dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input().dispatchEvent(new FocusEvent("blur"));
        equal(saves, afterSuccess);
        change("2026-11-23"); change("2026-11-24");
        pendingSaves[3].reject(new Error("Newer save failed"));
        pendingSaves[2].reject(new Error("Older save also failed"));
        await Promise.resolve(); await Promise.resolve();
        input().dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input().dispatchEvent(new FocusEvent("blur"));
        equal(saves, afterSuccess + 3);
        equal((data.view.filters[0].value as any).date.content, new Date("2026-11-24T00:00:00").getTime());
        pendingSaves[4].resolve(); await Promise.resolve();
        return "ok";
    }, sources);
    assert.match(result, /ok/);
});
