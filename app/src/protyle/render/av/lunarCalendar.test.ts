import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {formatLunarDate, getLunarMonths, lunarToSolar, parseLunarDate, solarToLunar} from "./lunarCalendar";
import {formatDateDisplay, parseDateValue} from "./dateFormat";
import {getCalendarDate} from "./calendar/date";

const languagesPath = join(__dirname, "../../../../appearance/langs");
const setLanguage = (name: string) => Object.defineProperty(globalThis, "window", {
    configurable: true, value: {siyuan: {languages: JSON.parse(readFileSync(join(languagesPath, name), "utf8"))}},
});

test("lunar input distinguishes leap months and rejects invalid or uncovered dates", () => {
    assert.deepEqual(solarToLunar(new Date(2025, 6, 25).valueOf()), {year: 2025, month: -6, day: 1});
    assert.notEqual(lunarToSolar({year: 2025, month: 6, day: 1}), lunarToSolar({year: 2025, month: -6, day: 1}));
    for (const date of [{year: 2026, month: -6, day: 1}, {year: 2025, month: -6, day: 30},
        {year: 1900, month: 1, day: 1}, {year: 2100, month: 12, day: 2}]) {
        assert.equal(lunarToSolar(date), undefined);
    }
    assert.equal(solarToLunar(new Date(1901, 1, 18).valueOf()), undefined);
    assert.equal(solarToLunar(new Date(2101, 0, 1).valueOf()), undefined);
    const early = new Date(0);
    early.setFullYear(50, 0, 2);
    assert.equal(solarToLunar(early.valueOf()), undefined);
    assert.equal(lunarToSolar({year: 2025, month: 1, day: 1.5}), undefined);
    assert.equal(lunarToSolar({year: 2025, month: 1, day: 1}, 24), undefined);
});

test("nonexistent local times during daylight saving transitions are rejected", () => {
    const originalTimezone = process.env.TZ;
    try {
        process.env.TZ = "America/New_York";
        const lunar = solarToLunar(new Date(2024, 2, 10, 1).valueOf());
        assert.equal(lunarToSolar(lunar, 2, 30), undefined);
        assert.notEqual(lunarToSolar(lunar, 3, 30), undefined);
    } finally {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    }
});

test("all supported month boundaries round trip in the existing local date semantics", () => {
    for (let year = 1901; year <= 2100; year++) {
        for (const month of getLunarMonths(year)) {
            for (const day of [1, month[3]]) {
                const lunar = {year, month: month[1], day};
                assert.deepEqual(solarToLunar(lunarToSolar(lunar, 14, 7)), lunar);
            }
        }
    }
});

test("all localized lunar display and clipboard values round trip, including date ranges", () => {
    for (const language of readdirSync(languagesPath).filter(name => name.endsWith(".json"))) {
        setLanguage(language);
        const lunar = {year: 2025, month: -6, day: 1};
        assert.deepEqual(parseLunarDate(formatLunarDate(lunar)), lunar, language);
        const start = lunarToSolar(lunar, 14, 7);
        const end = lunarToSolar({...lunar, day: 2}, 15, 8);
        const text = `${formatDateDisplay(start, "lunar", false)} → ${formatDateDisplay(end, "lunar", false)}`;
        const parsed = parseDateValue(text, "lunar");
        assert.equal(parsed.content, start, language);
        assert.equal(parsed.content2, end, language);
        assert.equal(parsed.hasEndDate, true, language);
        assert.equal(parsed.isNotTime, false, language);
        const original = new Date(1800, 0, 2, 14, 7).valueOf();
        assert.equal(parseDateValue(formatDateDisplay(original, "lunar", false), "lunar").content, original, language);
    }
});

test("Gregorian clipboard dates remain accepted in lunar fields", () => {
    setLanguage("en.json");
    assert.equal(parseDateValue("2025-07-25 14:07", "lunar").content, new Date(2025, 6, 25, 14, 7).valueOf());
});

test("unambiguous lunar, localized Gregorian, and ISO clipboard dates cross field calendars", () => {
    const formats: TAVDateFormat[] = ["", "full", "lunar", "month-day-year", "day-month-year", "year-month-day"];
    for (const language of readdirSync(languagesPath).filter(name => name.endsWith(".json"))) {
        setLanguage(language);
        const start = new Date(2025, 6, 25, 14, 7).valueOf();
        const end = new Date(2025, 6, 26, 15, 8).valueOf();
        for (const source of ["", "full", "lunar"] as TAVDateFormat[]) {
            const text = `${formatDateDisplay(start, source, false)} → ${formatDateDisplay(end, source, false)}`;
            for (const target of formats) {
                const parsed = parseDateValue(text, target);
                assert.equal(parsed.content, start, `${language}: ${source} to ${target}`);
                assert.equal(parsed.content2, end);
                assert.equal(parsed.hasEndDate, true);
                assert.equal(parsed.isNotTime, false);
            }
        }
        const legacy = new Date(1800, 0, 2, 14, 7).valueOf();
        assert.equal(parseDateValue(formatDateDisplay(legacy, "lunar", false), "full").content, legacy);
    }
    setLanguage("en.json");
    assert.equal(parseDateValue("07/08/2025", "month-day-year").content, new Date(2025, 6, 8).valueOf());
    assert.equal(parseDateValue("07/08/2025", "day-month-year").content, new Date(2025, 7, 7).valueOf());
    assert.equal(parseDateValue("07/08/2025", "lunar").isNotEmpty, false);
});

test("lunar text validates the entered time rather than a nonexistent local midnight", () => {
    const originalTimezone = process.env.TZ;
    try {
        process.env.TZ = "America/Sao_Paulo";
        setLanguage("en.json");
        const noon = new Date(2018, 10, 4, 12).valueOf();
        const lunar = solarToLunar(noon);
        assert.deepEqual(parseLunarDate(formatLunarDate(lunar)), lunar);
        for (const format of ["lunar", "full", ""] as TAVDateFormat[]) {
            assert.equal(parseDateValue(formatDateDisplay(noon, "lunar", false), format).content, noon);
        }
        assert.equal(parseDateValue(`${formatLunarDate(lunar)} 00:30`, "lunar").isNotEmpty, false);
    } finally {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    }
});

test("ISO date parsing retains its standalone behavior without a localized UI", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "window");
    try {
        assert.equal(parseDateValue("2026-09-01").content, new Date(2026, 8, 1).valueOf());
        assert.equal(parseDateValue("2026-09-01 14:07").content, new Date(2026, 8, 1, 14, 7).valueOf());
        assert.equal(parseDateValue("not a date").isNotEmpty, false);
    } finally {
        if (originalWindow) {
            Object.defineProperty(globalThis, "window", originalWindow);
        }
    }
});

test("calendar templates preserve the field calendar rules while clipboard parsing permits conversion", () => {
    setLanguage("en.json");
    const content = new Date(2025, 6, 25, 14, 7).valueOf();
    const value: IAVCellValue = {type: "date", date: {isNotEmpty: false}, hasRenderTemplate: true,
        renderedContent: formatDateDisplay(content, "lunar", false)};
    assert.equal(getCalendarDate(value, "lunar").content, content);
    assert.equal(getCalendarDate(value, "full"), undefined);
    assert.equal(parseDateValue(value.renderedContent, "full").content, content);
    value.renderedContent = formatDateDisplay(new Date(1800, 0, 2).valueOf(), "lunar");
    assert.equal(getCalendarDate(value, "full"), undefined);
});
