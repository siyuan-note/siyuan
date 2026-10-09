import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {formatLunarDate, getLunarMonths, lunarToSolar, parseLunarDate, solarToLunar} from "./lunarCalendar";
import {formatDateDisplay, parseDateValue} from "./dateFormat";

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
