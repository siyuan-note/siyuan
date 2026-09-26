import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

class Control {
    value = "";
    min = "";
    max = "";
    valid = true;
    focused = false;
    classes = new Set<string>();
    listeners: Record<string, () => void> = {};
    attributes: Record<string, string> = {};
    classList = {toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    addEventListener(type: string, listener: () => void) {
        this.listeners[type] = listener;
    }
    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
    }
    focus() {
        this.focused = true;
    }
    reportValidity() {
        return this.valid && !!this.value && (!this.min || Number(this.value) >= Number(this.min)) &&
            (!this.max || Number(this.value) <= Number(this.max));
    }
}

const loadJump = () => {
    const dateExports = {} as typeof import("./date");
    const compilerOptions = {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/calendar/date.ts", "utf8"),
        {compilerOptions}).outputText, {exports: dateExports, Date, Intl, Math, Number});
    const jumpExports = {} as typeof import("./jump");
    let current: {
        date: Control;
        mode: Control;
        weekFields: Control;
        year: Control;
        week: Control;
        confirm: {click: () => void};
        closed: boolean;
        options: {prefixContent: string; extraContent: string};
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/calendar/jump.ts", "utf8"),
        {compilerOptions}).outputText, {
        exports: jumpExports, Date, Number, window: {siyuan: {languages: {
            calendarJump: "Go to date or ISO week", calendarJumpDate: "Go to date",
            calendarISOWeek: "ISO week", calendarISOWeekYear: "ISO week year",
        }}},
        require: (name: string) => {
            if (name === "./date") {
                return dateExports;
            }
            if (name === "dayjs") {
                return require("dayjs");
            }
            if (name === "../../../../util/escape") {
                return {escapeAttr: (value: string) => value, escapeHtml: (value: string) => value};
            }
            if (name === "../../../../dialog/inputDialog") {
                return {openInputDialog: (options: {
                    value: string; min: string; max: string; prefixContent: string; extraContent: string;
                    onConfirm: (value: string, dialog: unknown) => void;
                }) => {
                    const date = new Control();
                    date.value = options.value;
                    const mode = new Control();
                    mode.value = "date";
                    const year = new Control();
                    const week = new Control();
                    const weekFields = new Control();
                    year.value = options.extraContent.match(/data-calendar-jump-year[^>]*value="([^"]+)"/)[1];
                    year.min = "1";
                    year.max = "9999";
                    week.value = options.extraContent.match(/data-calendar-jump-number[^>]*value="([^"]+)"/)[1];
                    week.min = "1";
                    week.max = options.extraContent.match(/data-calendar-jump-number[^>]*max="([^"]+)"/)[1];
                    const controls: Record<string, Control> = {
                        "[data-calendar-jump-mode]": mode, "[data-dialog-input]": date,
                        "[data-calendar-jump-week]": weekFields, "[data-calendar-jump-year]": year,
                        "[data-calendar-jump-number]": week,
                    };
                    current = {date, mode, year, week, weekFields, closed: false, options,
                        confirm: {click: () => options.onConfirm(date.value, dialog)}};
                    const dialog = {
                        element: {querySelector: (selector: string) => selector === "[data-input-confirm]" ?
                            current.confirm : controls[selector]},
                        bindInput: () => {},
                        destroy: () => { current.closed = true; },
                    };
                    return dialog;
                }};
            }
            throw new Error(name);
        },
    });
    return {open: jumpExports.openCalendarJump, current: () => current};
};

test("calendar jump keeps date entry and validates ISO week years", () => {
    const jump = loadJump();
    const anchor = new Date("2027-01-01T00:00:00").getTime();
    const targets: number[] = [];
    jump.open(anchor, 1, value => targets.push(value));
    let dialog = jump.current();
    assert.ok(dialog.options.prefixContent.includes("data-calendar-jump-mode"));
    assert.equal(dialog.date.value, "2027-01-01");
    assert.equal(dialog.date.attributes["aria-label"], "Go to date");
    assert.equal(dialog.year.value, "2026");
    assert.equal(dialog.week.value, "53");
    dialog.date.value = "";
    dialog.confirm.click();
    assert.equal(dialog.closed, false);
    assert.equal(targets.length, 0);
    dialog.date.value = "10000-01-01";
    dialog.date.valid = false;
    dialog.confirm.click();
    assert.equal(dialog.closed, false);
    assert.equal(targets.length, 0);
    dialog.date.value = "2024-02-29";
    dialog.date.valid = true;
    dialog.confirm.click();
    assert.equal(dialog.closed, true);
    assert.equal(targets[0], new Date("2024-02-29T00:00:00").getTime());

    jump.open(anchor, 1, value => targets.push(value));
    dialog = jump.current();
    dialog.mode.value = "week";
    dialog.mode.listeners.change();
    assert.equal(dialog.date.classes.has("fn__none"), true);
    assert.equal(dialog.weekFields.classes.has("fn__none"), false);
    assert.equal(dialog.year.focused, true);
    dialog.year.value = "2027";
    dialog.year.listeners.input();
    assert.equal(dialog.week.max, "52");
    dialog.confirm.click();
    assert.equal(dialog.closed, false);
    dialog.year.value = "2026";
    dialog.year.listeners.input();
    assert.equal(dialog.week.max, "53");
    dialog.confirm.click();
    assert.equal(dialog.closed, true);
    assert.equal(targets[1], new Date("2026-12-31T00:00:00").getTime());
});

test("week jump uses the Thursday in a Friday-start display row", () => {
    const jump = loadJump();
    jump.open(new Date("2027-01-01T00:00:00").getTime(), 5, () => {});
    assert.equal(jump.current().year.value, "2027");
    assert.equal(jump.current().week.value, "1");
});
