import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {compile} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("embedded calendars stay compact and centered in wide, narrow and mobile business containers", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries(["model", "yearInput", "field", "inline"].map(name => [name, join(__dirname, name + ".ts")])));
    const css = [readFileSync("appearance/themes/daylight/theme.css", "utf8"), compile("src/assets/scss/base.scss").css,
        compile("src/assets/scss/component/_date-picker.scss").css,
        compile("src/assets/scss/business/_av.scss").css,
        compile("src/assets/scss/business/_history.scss").css].join("\n");
    const result = await runBrowserCase(async (source, styles) => {
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field", "inline"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.split("/").at(-1)]);
        }
        const style = document.createElement("style");
        style.textContent = styles + "body{margin:0}";
        document.head.append(style);
        const languages = {date: "Date", datePickerTime: "Time", month: "Month", year: "Year", previous: "Previous", next: "Next",
            calendarToday: "Today", clear: "Clear", invalid: "Invalid"};
        const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
        for (const frontend of ["browser-desktop", "mobile", "browser-mobile"]) {
            document.documentElement.dataset.frontend = frontend;
            for (const width of [720, 400, 340, 268, 220]) {
                for (const context of ["filter", "condition-color", "jump", "snapshot", "dynamic-icon", "reminder"]) {
                    const container = document.createElement("div");
                    container.style.width = `${width}px`;
                    container.className = context === "filter" || context === "condition-color" ? "av__automation-filter" : "";
                    container.innerHTML = '<input class="b3-text-field" type="date" value="2026-11-12">' +
                        (context === "filter" || context === "condition-color" ? '<div class="av__filter-date-col"><span class="fn__block" data-host></span></div>' :
                            context === "snapshot" ? '<div class="history__snapshot-date-controls"><div class="history__snapshot-calendar" data-host></div></div>' :
                                context === "reminder" ? '<div class="date-picker__reminder"><div data-host></div></div>' : "<div data-host></div>");
                    document.body.replaceChildren(container);
                    const host = container.querySelector<HTMLElement>("[data-host]");
                    const handle = modules.inline.bindInlineDatePicker(host, container.querySelector("input"), {languages});
                    handle.activate(container.querySelector("input"));
                    const calendar = host.querySelector<HTMLElement>(".date-picker--inline");
                    const rect = calendar.getBoundingClientRect();
                    const hostRect = host.getBoundingClientRect();
                    check(Math.abs(rect.left - hostRect.left - (hostRect.right - rect.right)) < 1, `${context}/${frontend}/${width} is centered`);
                    check(rect.width <= (frontend === "browser-desktop" ? 244 : 320) + 1 && rect.width <= width, `${context} remains compact without overflow`);
                    if (context === "filter" || context === "condition-color") {
                        check(Math.abs(hostRect.width - width) < 1, `${context} calendar uses the complete rule width`);
                    }
                    calendar.querySelector<HTMLButtonElement>('[data-date="2026-11-14"]').click();
                    check(container.querySelector<HTMLInputElement>("input").value === "2026-11-14", `${context} selection still works`);
                    handle.destroy();
                }
            }
        }
        return "Calendar alignment passed";
    }, sources, css);
    assert.match(result, /Calendar alignment passed/);
});
