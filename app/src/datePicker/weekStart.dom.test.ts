import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "./test/browser";

for (const mobile of [false, true]) {
    test(`Monday-first calendar layout and keyboard boundaries (${mobile ? "mobile" : "desktop"})`, {
        timeout: 45000, skip: !canRunBrowser,
    }, async () => {
        const sources = browserSources({model: join(__dirname, "model.ts"), yearInput: join(__dirname, "yearInput.ts"),
            field: join(__dirname, "field.ts")});
        sources.languages = readFileSync("appearance/langs/en.json", "utf8");
        sources.mobile = String(mobile);
        const result = await runBrowserCase(async source => {
            const equal = (actual: unknown, expected: unknown) => {
                if (actual !== expected) { throw Error(`${actual} !== ${expected}`); }
            };
            const modules: Record<string, any> = {};
            for (const name of ["model", "yearInput", "field"]) {
                const exports = modules[name] = {};
                new Function("exports", "require", source[name])(exports, (path: string) => modules[path.substring(2)]);
            }
            if (source.mobile === "true") {
                const sidebar = document.createElement("div"); sidebar.id = "sidebar"; document.body.append(sidebar);
            }
            const languages = JSON.parse(source.languages);
            const originalLanguage = Object.getOwnPropertyDescriptor(navigator, "language");
            try {
                for (const locale of ["en-US", "en-GB", "fr-FR", "zh-CN", "zh-TW", "ja-JP", "ar-EG"]) {
                    for (const origin of ["option", "document", "navigator"]) {
                        document.documentElement.lang = origin === "document" ? locale : "";
                        Object.defineProperty(navigator, "language", {configurable: true, value: origin === "navigator" ? locale : "en-US"});
                        for (const [value, monday, sunday] of [
                            ["2026-02-01", "2026-01-26", "2026-02-01"],
                            ["2026-06-01", "2026-06-01", "2026-06-07"],
                            ["2024-02-29", "2024-02-26", "2024-03-03"],
                            ["2027-01-01", "2026-12-28", "2027-01-03"],
                        ]) {
                            const host = document.createElement("div");
                            host.dir = locale === "ar-EG" ? "rtl" : "ltr";
                            document.body.append(host);
                            const field = modules.field.createDateField(host, {type: "date", value, languages,
                                locale: origin === "option" ? locale : undefined});
                            const table = host.querySelector("table");
                            const headings = Array.from(table.querySelectorAll("th"));
                            equal(headings[0].getBoundingClientRect().left < headings[6].getBoundingClientRect().left, true);
                            const firstDay = new Date(`${value.substring(0, 7)}-01T00:00:00Z`);
                            firstDay.setUTCDate(firstDay.getUTCDate() - (firstDay.getUTCDay() + 6) % 7);
                            for (const row of Array.from(table.tBodies[0].rows)) {
                                for (const cell of Array.from(row.cells)) {
                                    equal(cell.querySelector<HTMLElement>("[data-date]").dataset.date, firstDay.toISOString().substring(0, 10));
                                    firstDay.setUTCDate(firstDay.getUTCDate() + 1);
                                }
                            }
                            equal(headings[0].getAttribute("aria-label"), new Intl.DateTimeFormat(locale,
                                {weekday: "long", timeZone: "UTC"}).format(Date.UTC(2024, 0, 8)));
                            equal(host.querySelector("select option").textContent, new Intl.DateTimeFormat(locale,
                                {month: "long", calendar: "gregory", timeZone: "UTC"}).format(Date.UTC(2024, 0, 1)));
                            const press = (from: string, key: string, expected: string) => {
                                const button = host.querySelector<HTMLButtonElement>(`[data-date="${from}"]`);
                                button.focus();
                                button.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
                                equal((document.activeElement as HTMLElement).dataset.date, expected);
                                equal(field.commit(), value);
                            };
                            press(value, "End", sunday);
                            press(value, "Home", monday);
                            press(monday, "Home", monday);
                            press(monday, "End", sunday);
                            press(sunday, "End", sunday);
                            press(sunday, "Home", monday);
                            const tuesday = new Date(`${monday}T00:00:00Z`);
                            tuesday.setUTCDate(tuesday.getUTCDate() + 1);
                            press(monday, "ArrowRight", tuesday.toISOString().substring(0, 10));
                            press(tuesday.toISOString().substring(0, 10), "ArrowLeft", monday);
                            field.destroy(); host.remove();
                        }
                    }
                }
            } finally {
                if (originalLanguage) { Object.defineProperty(navigator, "language", originalLanguage); }
                else { delete (navigator as any).language; }
            }
            return "Monday-first layout and navigation passed";
        }, sources);
        assert.match(result, /Monday-first layout and navigation passed/);
    });
}
