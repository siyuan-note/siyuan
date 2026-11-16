import * as assert from "node:assert/strict";
import test from "node:test";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../../datePicker/test/browser";

const cases = async (sources: Record<string, string>) => {
    const equal = (actual: unknown, expected: unknown, message = "") => {
        if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
    };
    const modules: Record<string, any> = {};
    const language = {calendarJump: "Jump", calendarJumpDate: "Date", calendarISOWeek: "Week", calendarISOWeekYear: "Year",
        date: "Date", datePickerTime: "Time", year: "Year", month: "Month", previous: "Previous", next: "Next",
        calendarToday: "Today", clear: "Clear", confirm: "Confirm", cancel: "Cancel", invalid: "Invalid"};
    (window as any).siyuan = {languages: language};
    let dialogs = 0;
    let current: any;
    const fallback = {
        isMobile: () => false,
        escapeAttr: (value: string) => value, escapeHtml: (value: string) => value,
        mobileInputDialog: (options: any) => {
            dialogs++;
            const element = document.createElement("div");
            element.innerHTML = `${options.prefixContent}<input data-dialog-input type="date" min="${options.min}" max="${options.max}" value="${options.value}">${options.extraContent}<button data-input-confirm>Confirm</button><button data-input-cancel>Cancel</button>`;
            document.body.append(element);
            current = {element, destroy: () => { options.destroyCallback?.(); element.remove(); }, bindInput() {}};
            const instance = current;
            element.querySelector("[data-input-confirm]").addEventListener("click", () => options.onConfirm(element.querySelector<HTMLInputElement>("[data-dialog-input]").value, instance));
            element.querySelector("[data-input-cancel]").addEventListener("click", () => instance.destroy());
            return instance;
        },
    };
    const load = (name: string, dependencies: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = modules[name] = {};
        new Function("require", "exports", sources[name])((request: string) => dependencies[request] || modules[request.split("/").at(-1)] || fallback, exports);
        return exports;
    };
    ["model", "yearInput", "field", "inline", "date"].forEach(name => load(name));
    const {openCalendarJump} = load("jump", {dayjs: () => ({format: () => "2024-02-28"})});
    const jumps: number[] = [];
    openCalendarJump(new Date(2024, 1, 28).valueOf(), 1, (value: number) => jumps.push(value));
    const root = current.element as HTMLElement;
    const input = root.querySelector<HTMLInputElement>("[data-dialog-input]");
    const confirm = root.querySelector<HTMLButtonElement>("[data-input-confirm]");
    equal(root.querySelectorAll(".date-picker__calendar").length, 1);
    input.focus(); input.click(); input.showPicker();
    equal(dialogs, 1, "opening the date picker does not create another dialog");
    root.querySelector<HTMLButtonElement>('[data-date="2024-02-29"]').click();
    equal(input.value, "2024-02-29");
    equal(jumps.length, 0, "choosing a day only edits the jump draft");
    root.querySelector<HTMLButtonElement>("[data-input-cancel]").click();
    equal(jumps.length, 0, "cancel never navigates");
    openCalendarJump(new Date(2024, 1, 28).valueOf(), 1, (value: number) => jumps.push(value));
    const second = current.element as HTMLElement;
    const source = second.querySelector<HTMLInputElement>("[data-dialog-input]");
    const submit = second.querySelector<HTMLButtonElement>("[data-input-confirm]");
    source.value = ""; source.dispatchEvent(new Event("input", {bubbles: true}));
    equal(submit.disabled, true, "empty dates disable confirmation");
    const mode = second.querySelector<HTMLSelectElement>("[data-calendar-jump-mode]");
    mode.value = "week"; mode.dispatchEvent(new Event("change", {bubbles: true}));
    equal(submit.disabled, false);
    equal(second.querySelector("[data-calendar-jump-picker]").classList.contains("fn__none"), true);
    const year = second.querySelector<HTMLInputElement>("[data-calendar-jump-year]");
    const week = second.querySelector<HTMLInputElement>("[data-calendar-jump-number]");
    year.value = "2027"; year.dispatchEvent(new Event("input", {bubbles: true}));
    week.value = "53"; submit.click();
    equal(jumps.length, 0, "invalid ISO week does not navigate");
    year.value = "2026"; year.dispatchEvent(new Event("input", {bubbles: true}));
    submit.click();
    equal(jumps[0], new Date(2026, 11, 31).valueOf());
    equal(confirm.isConnected, false);
    return "Embedded calendar jump passed";
};

test("calendar jump embeds one picker, stages navigation and retains ISO-week validation", {skip: !canRunBrowser}, async () => {
    const sources = browserSources({model: "src/datePicker/model.ts", yearInput: "src/datePicker/yearInput.ts",
        field: "src/datePicker/field.ts", inline: "src/datePicker/inline.ts", date: "src/protyle/render/av/calendar/date.ts",
        jump: "src/protyle/render/av/calendar/jump.ts"});
    assert.match(await runBrowserCase(cases, sources, "", {width: 360}), /Embedded calendar jump passed/);
});
