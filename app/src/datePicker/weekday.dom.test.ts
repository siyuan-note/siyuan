import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

test("Chinese weekday headings are single characters without changing week order or accessible names", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources(Object.fromEntries(["model", "yearInput", "field"].map(name => [name, join(__dirname, name + ".ts")])));
    sources.languages = readFileSync("appearance/langs/en.json", "utf8");
    const result = await runBrowserCase(async source => {
        const equal = (actual: unknown, expected: unknown) => {
            if (actual !== expected) { throw Error(`${actual} !== ${expected}`); }
        };
        const modules: Record<string, any> = {};
        for (const name of ["model", "yearInput", "field"]) {
            const exports = modules[name] = {};
            new Function("exports", "require", source[name])(exports, (path: string) => modules[path.substring(2)]);
        }
        for (const locale of ["zh-CN", "zh-TW", "en-US", "de-DE"]) {
            const host = document.createElement("div"); document.body.append(host);
            const field = modules.field.createDateField(host, {type: "date", value: "2026-02-10", locale,
                languages: JSON.parse(source.languages)});
            const info = new Intl.Locale(locale) as Intl.Locale & {getWeekInfo(): {firstDay: number}};
            const start = info.getWeekInfo().firstDay % 7;
            host.querySelectorAll("th").forEach((cell, index) => {
                const day = Date.UTC(2024, 0, 7 + (start + index) % 7);
                const full = new Intl.DateTimeFormat(locale, {weekday: "long", timeZone: "UTC"}).format(day);
                const visible = cell.querySelector(".date-picker__weekday-short").textContent;
                equal(visible, new Intl.DateTimeFormat(locale, {weekday: locale.startsWith("zh") ? "narrow" : "short", timeZone: "UTC"}).format(day));
                if (locale.startsWith("zh")) { equal("一二三四五六日".includes(visible) && visible.length === 1, true); }
                equal(cell.getAttribute("aria-label"), full);
                equal(cell.getAttribute("title"), full);
            });
            field.destroy(); host.remove();
        }
        return "weekday headings passed";
    }, sources);
    assert.match(result, /weekday headings passed/);
});
