import * as assert from "node:assert/strict";
import test from "node:test";
import {addDays, addMonths, candidateForDay, dateToDays, daysToDate, formatDate, formatTime,
    parseDate, parseTime, validateDateValue, valueToNumber, weekday} from "./model";

test("civil date parsing, arithmetic and weekdays do not depend on a timezone", () => {
    for (const value of ["0001-01-01", "0099-12-31", "1900-02-28", "2000-02-29", "2024-03-10", "2024-11-03", "275760-09-13"]) {
        const date = parseDate(value);
        assert.equal(formatDate(daysToDate(dateToDays(date))), value);
    }
    for (const invalid of ["", "0-01-01", "0000-01-01", "2024-2-01", "1900-02-29", "2023-02-29", "2024-04-31", "275760-09-14"]) {
        assert.equal(parseDate(invalid), undefined, invalid);
    }
    assert.equal(dateToDays(parseDate("1970-01-01")), 0);
    assert.equal(weekday(parseDate("1970-01-01")), 4);
    assert.equal(formatDate(addDays(parseDate("2024-02-28"), 1)), "2024-02-29");
    assert.equal(formatDate(addMonths(parseDate("2024-01-31"), 1)), "2024-02-29");
    assert.equal(formatDate(addMonths(parseDate("2024-02-29"), -12)), "2023-02-28");
    assert.equal(formatDate(addMonths(parseDate("0001-01-01"), -1)), "0001-01-01");
    assert.equal(formatDate(addDays(parseDate("275760-09-13"), 1)), "275760-09-13");
    assert.equal(valueToNumber("2024-03-10T02:30", "datetime-local"), dateToDays(parseDate("2024-03-10")) * 86400000 + 9000000);
    assert.equal(formatDate(parseDate("0002024-02-28")), "2024-02-28");
    assert.equal(formatDate(parseDate("00000001-01-01")), "0001-01-01");
    assert.equal(valueToNumber("0002024-02-28T12:00", "datetime-local"), valueToNumber("2024-02-28T12:00", "datetime-local"));
});

test("time parsing preserves seconds and milliseconds without creating instants", () => {
    for (const [value, normalized] of [["00:00", "00:00"], ["12:34:00", "12:34"], ["23:59:59.001", "23:59:59.001"],
        ["12:34:56.120", "12:34:56.12"]]) {
        assert.equal(formatTime(parseTime(value)), normalized);
    }
    for (const invalid of ["1:30", "24:00", "23:60", "12:30:60", "12:30:00.1234", "12:30Z", "12:30:00+01:00"]) {
        assert.equal(parseTime(invalid), undefined);
    }
    assert.equal(valueToNumber("2024-01-01 12:00", "datetime-local"), undefined);
    assert.equal(valueToNumber("2024-01-01T12:00Z", "datetime-local"), undefined);
});

test("empty, invalid and constrained drafts remain different states", () => {
    assert.equal(validateDateValue("", {type: "date"}), "valid");
    assert.equal(validateDateValue("", {type: "date", required: true}), "required");
    assert.equal(validateDateValue("2024-02-30", {type: "date"}), "format");
    const options = {type: "date" as const, min: "2024-02-01", max: "2024-02-10", step: "2"};
    assert.equal(validateDateValue("2024-02-03", options), "valid");
    assert.equal(validateDateValue("2024-02-04", options), "step");
    assert.equal(validateDateValue("2024-01-31", options), "min");
    assert.equal(validateDateValue("2024-02-11", options), "max");
    assert.equal(validateDateValue("2024-02-04", {...options, step: "any"}), "valid");
    assert.equal(validateDateValue("2024-02-04", {...options, min: "invalid", max: "invalid", step: "invalid"}), "valid");
    assert.equal(validateDateValue("12:00:30", {type: "time"}), "step");
    assert.equal(validateDateValue("12:00:30", {type: "time", stepBase: "11:00:30"}), "valid");
    assert.equal(validateDateValue("12:00:00.001", {type: "time", step: "0.001"}), "valid");
    for (const step of ["0x10", "0b10", "+2", " 2", "2 ", "2."]) {
        assert.equal(validateDateValue("12:01", {type: "time", step}), "valid");
    }
    assert.equal(validateDateValue("1970-01-03", {type: "date", step: "1.5"}), "valid");
    assert.equal(validateDateValue("1970-01-02", {type: "date", step: "1.5"}), "step");
    assert.equal(validateDateValue("12:00:00.001", {type: "time", step: "0.0007"}), "valid");
    assert.equal(validateDateValue("12:00:00.001", {type: "time", step: "0.0015"}), "step");
    assert.equal(validateDateValue("12:00:00.002", {type: "time", step: "0.0015"}), "valid");
    assert.equal(validateDateValue("12:00", {type: "time", step: "1e12"}), "step");
    assert.equal(validateDateValue("00:00:00.501", {type: "time", step: "0.5005"}), "valid");
    assert.equal(validateDateValue("00:00:00.500", {type: "time", step: "0.50049999999999999"}), "valid");
});

test("time ranges can wrap midnight and calendar days honor partial-day bounds and steps", () => {
    const overnight = {type: "time" as const, min: "22:00", max: "02:00"};
    ["22:00", "23:30", "00:00", "02:00"].forEach(value => assert.equal(validateDateValue(value, overnight), "valid"));
    assert.equal(validateDateValue("12:00", overnight), "min");
    const options = {type: "datetime-local" as const, min: "2024-05-01T10:05", max: "2024-05-02T11:00", step: "1800"};
    assert.equal(candidateForDay(parseDate("2024-04-30"), options), undefined);
    assert.equal(candidateForDay(parseDate("2024-05-01"), options), "2024-05-01T10:05");
    assert.equal(candidateForDay(parseDate("2024-05-02"), options, "10:35"), "2024-05-02T10:35");
    assert.equal(candidateForDay(parseDate("2024-05-03"), options), undefined);
    assert.equal(candidateForDay(parseDate("2024-05-02"), {type: "date", min: "2024-05-01", step: "2"}), undefined);
    const spaced = {type: "datetime-local" as const, min: "2024-05-01 10:00", max: "9999-12-31 23:59"};
    assert.equal(candidateForDay(parseDate("2024-05-01"), spaced), "2024-05-01T10:00");
    assert.equal(candidateForDay(parseDate("10000-01-01"), spaced), undefined);
    assert.equal(validateDateValue("2024-05-01T09:00", spaced), "min");
    assert.equal(validateDateValue("2024-05-01T10:00:30", {type: "datetime-local", stepBase: "2024-05-01 09:00:30"}), "valid");
});
