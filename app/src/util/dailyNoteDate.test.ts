import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readdirSync} from "node:fs";
import {join} from "node:path";
import {parseDailyNoteDate} from "./dailyNoteDate";
import {canReferenceDailyNoteNotebook} from "./dailyNote";

const now = new Date(2026, 9, 8, 12);

test("daily note dates recognize current-language and English expressions", () => {
    for (const [locale, input, date] of [
        ["en", "today", "2026-10-08"], ["zh-CN", "明天", "2026-10-09"],
        ["zh-TW", "昨天", "2026-10-07"], ["ja", "今日", "2026-10-08"],
        ["fr", "aujourd’hui", "2026-10-08"], ["de", "morgen", "2026-10-09"],
        ["es", "mañana", "2026-10-09"], ["fr", "TODAY", "2026-10-08"],
        ["zh-CN", "25 sept", "2026-09-25"], ["en", "September 25, 2027", "2027-09-25"],
        ["en", "7th October 2026", "2026-10-07"], ["fr", "25 septembre", "2026-09-25"],
        ["de", "25. September", "2026-09-25"], ["es", "25 de septiembre", "2026-09-25"],
        ["ru", "25 сентября", "2026-09-25"], ["zh-CN", "9月25日", "2026-09-25"],
        ["ja", "2027年9月25日", "2027-09-25"], ["ko", "9월25일", "2026-09-25"],
        ["en", "2024-02-29", "2024-02-29"], ["en", "２０２６-０９-２５", "2026-09-25"],
    ]) {
        assert.deepEqual(parseDailyNoteDate(input, locale, now), {date}, `${locale}: ${input}`);
    }
});

test("all bundled languages recognize their relative dates and Gregorian month forms", () => {
    const languages = readdirSync(join(__dirname, "../../appearance/langs")).filter(file => file.endsWith(".json"));
    assert.equal(languages.length, 22);
    for (const filename of languages) {
        const locale = filename.slice(0, -5);
        const relative = new Intl.RelativeTimeFormat(locale, {numeric: "auto"});
        for (const [offset, expected] of [[-1, "2026-10-07"], [0, "2026-10-08"], [1, "2026-10-09"]] as const) {
            const word = relative.format(offset, "day");
            const ambiguous = offset !== 0 && word === relative.format(-offset, "day");
            assert.deepEqual(parseDailyNoteDate(word, locale, now), ambiguous ? {error: true} : {date: expected}, locale);
            const numeric = new Intl.RelativeTimeFormat(locale, {numeric: "always"});
            assert.deepEqual(parseDailyNoteDate(numeric.format(offset, "day"), locale, now), {date: expected}, locale);
        }
        for (const month of ["long", "short"] as const) {
            const formatter = new Intl.DateTimeFormat(locale, {
                calendar: "gregory", numberingSystem: "latn", month, day: "numeric",
            });
            const input = formatter.format(new Date(2026, 8, 25));
            const numericMonth = /^\d+$/.test(formatter.formatToParts(new Date(2026, 8, 25)).find(part => part.type === "month")?.value || "") && !/[月월]/.test(input);
            assert.deepEqual(parseDailyNoteDate(input, locale, now), numericMonth ? {error: true} : {date: "2026-09-25"}, `${locale}: ${input}`);
        }
    }
});

test("date parsing rejects invalid and ambiguous dates without hijacking document names", () => {
    for (const input of ["03/04", "25/09/2026", "2026-02-29", "2026-13-01", "31 sept", "9月31日"]) {
        assert.deepEqual(parseDailyNoteDate(input, "zh-CN", now), {error: true}, input);
    }
    for (const input of ["", "my today notes", "25 septembernotes", "project May", "yesterday report", "25 octobre"]) {
        assert.equal(parseDailyNoteDate(input, "en", now), undefined, input);
    }
    assert.deepEqual(parseDailyNoteDate("tomorrow", "en", new Date(2026, 11, 31, 23, 59)), {date: "2027-01-01"});
});

test("daily note references preserve encrypted notebook boundaries", () => {
    assert.equal(canReferenceDailyNoteNotebook("a", "a", true, true), true);
    assert.equal(canReferenceDailyNoteNotebook("a", "b", true, true), false);
    assert.equal(canReferenceDailyNoteNotebook("a", "b", true, false), false);
    assert.equal(canReferenceDailyNoteNotebook("a", "b", false, true), false);
    assert.equal(canReferenceDailyNoteNotebook("a", "b", false, false), true);
});
