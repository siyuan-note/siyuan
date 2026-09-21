import * as assert from "node:assert/strict";
import {test} from "node:test";
import {addCalendarDays, calendarDayDistance, getCalendarInterval, getCalendarRange, moveCalendarDate,
    packCalendarWeek, resizeCalendarDate} from "./date";

const day = (date: string) => new Date(`${date}T00:00:00`).getTime();

test("calendar range covers leap months and seven local days", () => {
    const month = getCalendarRange(day("2024-02-29"), "month", 1);
    assert.equal(new Date(month.start).getDay(), 1);
    assert.equal(calendarDayDistance(month.start, month.end), 35);
    assert.ok(month.start <= day("2024-02-01") && month.end > day("2024-02-29"));
    const week = getCalendarRange(day("2026-09-20"), "week", 0);
    assert.equal(week.start, day("2026-09-20"));
    assert.equal(calendarDayDistance(week.start, week.end), 7);
    assert.equal(calendarDayDistance(day("0099-12-31"), day("0100-01-01")), 1);
});

test("calendar month uses only the four, five or six weeks needed", () => {
    const cases = [
        {anchor: "2021-02-15", weekStart: 1, start: "2021-02-01", end: "2021-03-01", days: 28},
        {anchor: "2026-09-21", weekStart: 1, start: "2026-08-31", end: "2026-10-05", days: 35},
        {anchor: "2026-03-15", weekStart: 1, start: "2026-02-23", end: "2026-04-06", days: 42},
        {anchor: "2026-03-15", weekStart: 0, start: "2026-03-01", end: "2026-04-05", days: 35},
        {anchor: "2024-12-15", weekStart: 1, start: "2024-11-25", end: "2025-01-06", days: 42},
    ];
    for (const item of cases) {
        const range = getCalendarRange(day(item.anchor), "month", item.weekStart);
        assert.equal(range.start, day(item.start));
        assert.equal(range.end, day(item.end));
        assert.equal(calendarDayDistance(range.start, range.end), item.days);
    }
});

test("calendar month covers every day without extra weeks for every week start", () => {
    for (const year of [1, 99, 2024, 2025, 2026, 9999]) {
        for (let month = 0; month < 12; month++) {
            const first = new Date(0);
            first.setFullYear(year, month, 1);
            first.setHours(0, 0, 0, 0);
            const next = new Date(first);
            next.setMonth(month + 1);
            for (let weekStart = 0; weekStart < 7; weekStart++) {
                const range = getCalendarRange(first.getTime(), "month", weekStart);
                assert.equal(new Date(range.start).getDay(), weekStart);
                assert.equal(new Date(range.end).getDay(), weekStart);
                assert.ok(range.start <= first.getTime() && range.end >= next.getTime());
                assert.ok(addCalendarDays(range.start, 7) > first.getTime());
                assert.ok(addCalendarDays(range.end, -7) < next.getTime());
                assert.ok([28, 35, 42].includes(calendarDayDistance(range.start, range.end)));
            }
        }
    }
});

test("calendar month boundaries stay at local midnight across daylight saving changes", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
        for (const anchor of ["2026-03-15", "2026-11-15"]) {
            const range = getCalendarRange(day(anchor), "month", 1);
            assert.equal(new Date(range.start).getHours(), 0);
            assert.equal(new Date(range.end).getHours(), 0);
            assert.notEqual(new Date(range.start).getTimezoneOffset(), new Date(range.end).getTimezoneOffset());
            assert.equal(calendarDayDistance(range.start, range.end), 42);
        }
    } finally {
        if (previous === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = previous;
        }
    }
});

test("calendar all-day end is inclusive and timed midnight is exclusive", () => {
    const value = {type: "date" as const, date: {content: day("2026-09-19"), content2: day("2026-09-20"),
        isNotEmpty: true, isNotEmpty2: true, hasEndDate: true, isNotTime: true}};
    assert.equal(getCalendarInterval(value).end, day("2026-09-21"));
    value.date.isNotTime = false;
    assert.equal(getCalendarInterval(value).end, day("2026-09-20"));
    const segments = packCalendarWeek([{...getCalendarInterval(value), row: {id: "one", cells: []}, date: {value}}], day("2026-09-14"));
    assert.equal(segments[0].span, 1);
    assert.equal(segments[0].column, 5);
});

test("missing and reversed endpoints preserve the source value", () => {
    assert.equal(getCalendarInterval({type: "date", date: {isNotEmpty: false}}), undefined);
    const value = {type: "date" as const, date: {content: day("2026-09-22"), content2: day("2026-09-20"),
        isNotEmpty: false, isNotEmpty2: true, hasEndDate: true}};
    assert.equal(getCalendarInterval(value).start, value.date.content2);
    value.date.isNotEmpty = true;
    const before = JSON.stringify(value);
    assert.equal(getCalendarInterval(value).invalid, true);
    assert.equal(JSON.stringify(value), before);
});

test("calendar packing splits cross-week events without overlapping lanes", () => {
    const start = day("2026-09-14");
    const events = Array.from({length: 100}, (_, i) => ({start: addCalendarDays(start, i % 7 - 3),
        end: addCalendarDays(start, i % 7 + 9), invalid: false, row: {id: `${i}`, cells: []}, date: {}}));
    const segments = packCalendarWeek(events, start);
    assert.equal(segments.length, 100);
    for (const segment of segments) {
        assert.ok(segment.column >= 0 && segment.column + segment.span <= 7);
        assert.equal(segments.filter(other => other.lane === segment.lane).length, 1);
    }
    assert.equal(segments[0].starts, false);
    assert.equal(segments[0].ends, false);
});

test("drag preserves wall-clock times and supports either endpoint", () => {
    const start = new Date(2026, 2, 7, 10, 30).getTime();
    const end = new Date(2026, 2, 9, 16, 45).getTime();
    const date = {content: start, content2: end, isNotEmpty: true, isNotEmpty2: true, hasEndDate: true, isNotTime: false};
    const moved = moveCalendarDate(date, 1);
    assert.equal(new Date(moved.content).getHours(), 10);
    assert.equal(new Date(moved.content2).getHours(), 16);
    assert.equal(calendarDayDistance(date.content, moved.content), 1);
    assert.equal(resizeCalendarDate(date, "end", day("2026-03-06")), undefined);
    assert.equal(new Date(resizeCalendarDate(date, "end", day("2026-03-11")).content2).getMinutes(), 45);
    assert.equal(resizeCalendarDate({...date, content2: day("2026-03-10")}, "end", day("2026-03-10")).content2, day("2026-03-11"));
    const endOnly = {hasEndDate: true, isNotEmpty2: true, content2: end};
    assert.equal(moveCalendarDate(endOnly, 2).content, undefined);
    assert.equal(calendarDayDistance(end, moveCalendarDate(endOnly, 2).content2), 2);
});
