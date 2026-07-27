import assert from "node:assert/strict";
import test from "node:test";

(globalThis as typeof globalThis & { window: unknown }).window = {
    siyuan: {
        languages: {
            _attrView: {
                dateMonths: "January|February|March|April|May|June|July|August|September|October|November|December",
                dateFormatFullTemplate: "${month} ${day}, ${year}",
            }
        }
    }
};

const loadDateFormat = () => import("../src/protyle/render/av/dateFormat");

test("uses localized dates for newly created date fields", async () => {
    const {getDefaultDateFormat} = await loadDateFormat();
    assert.equal(getDefaultDateFormat("date"), "full");
    assert.equal(getDefaultDateFormat("created"), "full");
    assert.equal(getDefaultDateFormat("updated"), "full");
    assert.equal(getDefaultDateFormat("text"), "");
});

test("formats dates with the same fixed patterns as the kernel", async () => {
    const {formatDateDisplay} = await loadDateFormat();
    const content = new Date(2024, 2, 5, 14, 7).valueOf();
    assert.equal(formatDateDisplay(content, "", true), "2024-03-05");
    assert.equal(formatDateDisplay(content, "full", true), "March 5, 2024");
    assert.equal(formatDateDisplay(content, "month-day-year", false), "03/05/2024 14:07");
    assert.equal(formatDateDisplay(content, "day-month-year", true), "05/03/2024");
    assert.equal(formatDateDisplay(content, "year-month-day", true), "2024/03/05");
});

test("parses displayed dates strictly according to the field format", async () => {
    const {parseDateValue} = await loadDateFormat();
    const parsed = parseDateValue("05/03/2024 14:07 → 06/04/2024 15:08", "day-month-year");
    assert.equal(parsed.content, new Date(2024, 2, 5, 14, 7).valueOf());
    assert.equal(parsed.content2, new Date(2024, 3, 6, 15, 8).valueOf());
    assert.equal(parsed.hasEndDate, true);
    assert.equal(parsed.isNotTime, false);

    const full = parseDateValue("March 5, 2024", "full");
    assert.equal(full.content, new Date(2024, 2, 5).valueOf());
    assert.equal(full.isNotTime, true);

    assert.equal(parseDateValue("03/05/2024", "").isNotEmpty, false);
    assert.equal(parseDateValue("2024-02-30", "").isNotEmpty, false);
});
