import * as dayjs from "dayjs";
import {openInputDialog} from "../../../../dialog/inputDialog";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getCalendarRange, getISOWeekForCalendarRow, getISOWeeksInYear, getISOWeekThursday} from "./date";

export const openCalendarJump = (anchor: number, weekStart: number, onJump: (date: number) => void) => {
    const rowStart = getCalendarRange(anchor, "week", weekStart).start;
    const rowWeek = getISOWeekForCalendarRow(rowStart);
    const currentWeek = rowWeek.year < 1 ? {year: 1, week: 1} : rowWeek.year > 9999 ?
        {year: 9999, week: getISOWeeksInYear(9999)} : rowWeek;
    const languages = window.siyuan.languages;
    const dialog = openInputDialog({
        title: languages.calendarJump,
        type: "date",
        value: dayjs(anchor).format("YYYY-MM-DD"),
        min: "0001-01-01",
        max: "9999-12-31",
        prefixContent: `<select class="b3-select fn__block av__calendar-jump-mode" data-calendar-jump-mode aria-label="${escapeAttr(languages.calendarJump)}">
            <option value="date">${escapeHtml(languages.calendarJumpDate)}</option>
            <option value="week">${escapeHtml(languages.calendarISOWeek)}</option>
        </select>`,
        extraContent: `<div class="av__calendar-jump-week fn__none" data-calendar-jump-week>
            <label>${escapeHtml(languages.calendarISOWeekYear)}<input class="b3-text-field fn__block" data-calendar-jump-year type="number" min="1" max="9999" step="1" required value="${currentWeek.year}"></label>
            <label>${escapeHtml(languages.calendarISOWeek)}<input class="b3-text-field fn__block" data-calendar-jump-number type="number" min="1" max="${getISOWeeksInYear(currentWeek.year)}" step="1" required value="${currentWeek.week}"></label>
        </div>`,
        onConfirm: (value, currentDialog) => {
            const mode = currentDialog.element.querySelector<HTMLSelectElement>("[data-calendar-jump-mode]");
            let target: number;
            if (mode.value === "week") {
                const yearInput = currentDialog.element.querySelector<HTMLInputElement>("[data-calendar-jump-year]");
                const weekInput = currentDialog.element.querySelector<HTMLInputElement>("[data-calendar-jump-number]");
                if (!yearInput.value || !yearInput.reportValidity() || !weekInput.value || !weekInput.reportValidity()) {
                    return;
                }
                target = getISOWeekThursday(Number(yearInput.value), Number(weekInput.value));
                if (target === undefined) {
                    return;
                }
            } else {
                const input = currentDialog.element.querySelector<HTMLInputElement>("[data-dialog-input]");
                if (!value || !input.reportValidity()) {
                    return;
                }
                target = new Date(`${value}T00:00:00`).getTime();
            }
            currentDialog.destroy();
            onJump(target);
        },
    });
    const mode = dialog.element.querySelector<HTMLSelectElement>("[data-calendar-jump-mode]");
    const dateInput = dialog.element.querySelector<HTMLInputElement>("[data-dialog-input]");
    dateInput.setAttribute("aria-label", languages.calendarJumpDate);
    const weekFields = dialog.element.querySelector<HTMLElement>("[data-calendar-jump-week]");
    const yearInput = dialog.element.querySelector<HTMLInputElement>("[data-calendar-jump-year]");
    const weekInput = dialog.element.querySelector<HTMLInputElement>("[data-calendar-jump-number]");
    const confirm = dialog.element.querySelector<HTMLButtonElement>("[data-input-confirm]");
    mode.addEventListener("change", () => {
        const isWeek = mode.value === "week";
        dateInput.classList.toggle("fn__none", isWeek);
        weekFields.classList.toggle("fn__none", !isWeek);
        (isWeek ? yearInput : dateInput).focus();
    });
    yearInput.addEventListener("input", () => {
        const year = Number(yearInput.value);
        weekInput.max = Number.isInteger(year) && year >= 1 && year <= 9999 ?
            getISOWeeksInYear(year).toString() : "53";
    });
    dialog.bindInput(yearInput, () => confirm.click());
    dialog.bindInput(weekInput, () => confirm.click());
    dateInput.focus();
    return dialog;
};
