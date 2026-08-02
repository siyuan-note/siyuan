import * as dayjs from "dayjs";
import {Dialog} from "../../../../dialog";
import {Constants} from "../../../../constants";
import {showMessage} from "../../../../dialog/message";
import {openFileById} from "../../../../editor/util";
/// #if MOBILE
import {openMobileFileById} from "../../../../mobile/editor";
/// #endif
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getCalendarFieldMapping, isCalendarRecurrenceStorageField} from "./mapped-fields";
import {getEventDocumentID, ICalendarEventDraft, ICalendarNormalizedEvent} from "./model";
import {CalendarRecurrencePreset, describeRecurrence, detectRecurrencePreset, getRecurrencePresetRule, renderRecurrencePresetOptions} from "./recurrence-summary";
import {shouldResetCustomWeekdays} from "./recurrence";
import {ensureCalendarRecurrenceStorage} from "./recurrence-storage";
import {createCalendarEvent, createCalendarEventAsDocument, createCalendarEventReplacingOccurrence, deleteCalendarEvent, deleteCalendarEventDocument, deleteCalendarEventThisAndFuture, deleteCalendarOccurrence, updateCalendarEvent, updateCalendarEventThisAndFuture} from "./transactions";

export type CalendarRecurrenceScope = "occurrence" | "future" | "series";

interface IRecurrenceFormValue {
    freq: string;
    interval: string;
    count: string;
    until: string;
    byDay: string[];
    raw: string;
    isAdvanced: boolean;
}

export interface IEventDialogOptions {
    event?: ICalendarNormalizedEvent;
    /** Base row for whole-series edits opened from a generated occurrence. */
    seriesEvent?: ICalendarNormalizedEvent;
    draft?: Partial<ICalendarEventDraft>;
    date: string;
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    onSave?: () => void;
    onDelete?: () => void;
    readOnly?: boolean;
    /** The view creates each entry as a SiYuan document instead of a bare row. */
    createAsDocument?: boolean;
    /** New-item template that resolves the notebook/path of created pages. */
    templateID?: string;
}

const getViewID = (options: IEventDialogOptions) => options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "";

const getCalendarLocale = () => window.siyuan.config.lang;

/**
 * Recurrence weekday buttons are deliberately one glyph wide. Chinese Intl
 * labels share a 周／週／星期 prefix, so taking the first glyph turns every day
 * into the same 周. Strip that prefix before choosing the compact glyph.
 */
export const getCompactWeekdayLabel = (label: string) => {
    const withoutChinesePrefix = label.replace(/^(?:星期|週|周)/u, "");
    return Array.from(withoutChinesePrefix || label)[0] || label;
};

const getWeekdayLabels = () => {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "short"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + index)));
};

const isDateInputValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const isRealDateInputValue = (value: string) => {
    const parsed = dayjs(value);
    return isDateInputValue(value) && parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
};

const parseRecurrenceUntilDate = (value: string) => {
    if (/^\d{8}$/.test(value)) {
        return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    }
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/);
    if (dateTimeMatch) {
        return `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`;
    }
    return value.slice(0, 10);
};

const getPositiveIntegerInputValue = (value: string, fallback?: number) => {
    if (!/^\d+$/.test(value)) {
        return fallback;
    }
    const parsed = parseInt(value, 10);
    return parsed > 0 ? parsed : fallback;
};

const parseRecurrenceFormValue = (value?: string): IRecurrenceFormValue => {
    const raw = (value || "").trim();
    if (!raw || raw.toLowerCase() === "none") {
        return {freq: "", interval: "1", count: "", until: "", byDay: [], raw: "", isAdvanced: false};
    }
    const upper = raw.toUpperCase();
    if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(upper)) {
        return {freq: upper, interval: "1", count: "", until: "", byDay: [], raw, isAdvanced: false};
    }
    const result: IRecurrenceFormValue = {freq: "", interval: "1", count: "", until: "", byDay: [], raw, isAdvanced: false};
    const supportedKeys = ["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY"];
    const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const seenKeys = new Set<string>();
    upper.split(";").filter(Boolean).forEach(part => {
        const [key, val] = part.split("=");
        if (!supportedKeys.includes(key) || seenKeys.has(key)) {
            result.isAdvanced = true;
            return;
        }
        seenKeys.add(key);
        if (!val) {
            result.isAdvanced = true;
            return;
        }
        if (key === "FREQ") {
            if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(val)) {
                result.freq = val;
            } else {
                result.isAdvanced = true;
            }
        } else if (key === "INTERVAL") {
            if (/^\d+$/.test(val) && parseInt(val, 10) > 0) {
                result.interval = val;
            } else {
                result.isAdvanced = true;
            }
        } else if (key === "COUNT") {
            if (/^\d+$/.test(val) && parseInt(val, 10) > 0) {
                result.count = val;
            } else {
                result.isAdvanced = true;
            }
        } else if (key === "UNTIL") {
            const until = parseRecurrenceUntilDate(val);
            if (isRealDateInputValue(until)) {
                result.until = until;
            } else {
                result.isAdvanced = true;
            }
        } else if (key === "BYDAY") {
            const byDay = val.split(",");
            result.byDay = byDay.filter(day => weekdays.includes(day));
            if (result.byDay.length !== byDay.length || new Set(result.byDay).size !== result.byDay.length) {
                result.isAdvanced = true;
            }
        }
    });
    result.isAdvanced = result.isAdvanced || !result.freq || (result.byDay.length > 0 && result.freq !== "WEEKLY");
    return result;
};

const renderRecurrenceFields = (event: ICalendarNormalizedEvent | undefined, readOnly: boolean, startDate: string) => {
    const rawRule = event?.recurrenceRaw || event?.recurrence?.freq || "";
    const recurrence = parseRecurrenceFormValue(rawRule);
    const labels = getWeekdayLabels();
    const weekdays = [
        {value: "SU", label: labels[0]},
        {value: "MO", label: labels[1]},
        {value: "TU", label: labels[2]},
        {value: "WE", label: labels[3]},
        {value: "TH", label: labels[4]},
        {value: "FR", label: labels[5]},
        {value: "SA", label: labels[6]},
    ];
    if (recurrence.isAdvanced) {
        return `<input class="b3-text-field fn__block" id="av-event-recurrence-raw" readonly value="${escapeAttr(recurrence.raw)}">
<div class="ft__on-surface ft__smaller">${window.siyuan.languages.calendarRecurringAdvancedReadOnly || "Advanced recurrence is retained (not editable here)."}</div>`;
    }
    const disabledAttr = readOnly ? " disabled" : "";
    // The preset menu is the face of recurrence; the FREQ/INTERVAL/COUNT/UNTIL/
    // BYDAY row below stays as the "Custom" escape hatch and remains the single
    // source of truth that getRecurrenceFromDialog reads. Choosing a preset only
    // writes into those controls, so a preset can never store a rule the
    // detailed controls could not have produced.
    const preset = detectRecurrencePreset(rawRule, startDate);
    return `<div class="av__calendar-repeat" data-type="calendar-repeat">
    <select class="b3-select fn__block" id="av-event-recurrence-preset" data-type="calendar-recurrence-preset" aria-label="${escapeAttr(window.siyuan.languages.calendarRepeat || "Repeat")}"${disabledAttr}>
        ${renderRecurrencePresetOptions(preset, startDate)}
    </select>
    <div class="av__calendar-recurrence" id="av-event-recurrence-custom" data-type="calendar-recurrence-custom"${preset === "custom" ? "" : ' style="display:none"'}>
        <div class="av__calendar-recurrence-row">
            <label for="av-event-recurrence-interval">${escapeHtml(window.siyuan.languages.calendarRepeatEvery || "Repeat every")}</label>
            <input type="number" min="1" step="1" class="b3-text-field" id="av-event-recurrence-interval" aria-label="${window.siyuan.languages.calendarInterval || "Interval"}" value="${escapeAttr(recurrence.interval || "1")}"${disabledAttr}>
            <select class="b3-select" id="av-event-recurrence-freq" aria-label="${escapeAttr(window.siyuan.languages.calendarRepeat || "Repeat")}"${disabledAttr}>
                <option value="DAILY"${recurrence.freq === "DAILY" ? " selected" : ""}>${window.siyuan.languages.calendarDay || "Day"}</option>
                <option value="WEEKLY"${recurrence.freq === "WEEKLY" || !recurrence.freq ? " selected" : ""}>${window.siyuan.languages.calendarWeek || "Week"}</option>
                <option value="MONTHLY"${recurrence.freq === "MONTHLY" ? " selected" : ""}>${window.siyuan.languages.calendarMonth || "Month"}</option>
                <option value="YEARLY"${recurrence.freq === "YEARLY" ? " selected" : ""}>${window.siyuan.languages.calendarYear || "Year"}</option>
            </select>
        </div>
        <div class="av__calendar-recurrence-weekly" data-type="calendar-weekday-row">
            <span>${escapeHtml(window.siyuan.languages.calendarRepeatOn || "Repeat on")}</span>
            <div class="av__calendar-weekday">
                ${weekdays.map(day => `<label class="av__calendar-weekday-item">
                    <input type="checkbox" data-type="calendar-recurrence-weekday" value="${day.value}"${recurrence.byDay.includes(day.value) ? " checked" : ""}${disabledAttr}>
                    <span>${escapeHtml(getCompactWeekdayLabel(day.label))}</span>
                </label>`).join("")}
            </div>
        </div>
        <fieldset class="av__calendar-recurrence-end">
            <legend>${escapeHtml(window.siyuan.languages.calendarEnd || "End")}</legend>
            <label><input type="radio" name="calendar-recurrence-end" value="never"${!recurrence.until && !recurrence.count ? " checked" : ""}${disabledAttr}> ${escapeHtml(window.siyuan.languages.calendarNever || "Never")}</label>
            <label><input type="radio" name="calendar-recurrence-end" value="until"${recurrence.until ? " checked" : ""}${disabledAttr}> ${escapeHtml(window.siyuan.languages.calendarOn || "On")} <input type="date" class="b3-text-field" id="av-event-recurrence-until" value="${escapeAttr(recurrence.until)}"${recurrence.until ? "" : " disabled"}${disabledAttr}></label>
            <label><input type="radio" name="calendar-recurrence-end" value="count"${recurrence.count ? " checked" : ""}${disabledAttr}> ${escapeHtml(window.siyuan.languages.calendarAfter || "After")} <input type="number" min="1" step="1" class="b3-text-field" id="av-event-recurrence-count" value="${escapeAttr(recurrence.count || "13")}"${recurrence.count ? "" : " disabled"}${disabledAttr}> ${escapeHtml(window.siyuan.languages.calendarOccurrences || "occurrences")}</label>
        </fieldset>
    </div>
    <div class="av__calendar-repeat-summary ft__on-surface ft__smaller" id="av-event-recurrence-summary" data-type="calendar-recurrence-summary" aria-live="polite">${escapeHtml(describeRecurrence(rawRule, startDate))}</div>
</div>`;
};

const CALENDAR_RECURRENCE_WEEKDAY_SELECTOR = '[data-type="calendar-recurrence-weekday"]';

/**
 * Pushes a preset's rule down into the detailed controls. The controls stay the
 * only thing getRecurrenceFromDialog reads, so presets and Custom can never
 * disagree about what will be saved.
 */
const writeRecurrenceRuleToControls = (dialog: Dialog, rule: string) => {
    const parsed = parseRecurrenceFormValue(rule);
    const freqSelect = dialog.element.querySelector("#av-event-recurrence-freq") as HTMLSelectElement;
    if (!freqSelect) {
        return;
    }
    freqSelect.value = parsed.freq;
    const intervalInput = dialog.element.querySelector("#av-event-recurrence-interval") as HTMLInputElement;
    if (intervalInput) {
        intervalInput.value = parsed.interval || "1";
    }
    const countInput = dialog.element.querySelector("#av-event-recurrence-count") as HTMLInputElement;
    if (countInput) {
        countInput.value = parsed.count;
    }
    const untilInput = dialog.element.querySelector("#av-event-recurrence-until") as HTMLInputElement;
    if (untilInput) {
        untilInput.value = parsed.until;
    }
    const endMode = parsed.until ? "until" : (parsed.count ? "count" : "never");
    const endRadio = dialog.element.querySelector(`input[name="calendar-recurrence-end"][value="${endMode}"]`) as HTMLInputElement;
    if (endRadio) {
        endRadio.checked = true;
        endRadio.dispatchEvent(new Event("change", {bubbles: true}));
    }
    dialog.element.querySelectorAll(CALENDAR_RECURRENCE_WEEKDAY_SELECTOR).forEach(item => {
        const checkbox = item as HTMLInputElement;
        checkbox.checked = parsed.byDay.includes(checkbox.value);
    });
};

const renderColorField = (field?: IAVColumn, event?: ICalendarNormalizedEvent, readOnly = false) => {
    if (!field || !["select", "mSelect"].includes(field.type)) {
        return "";
    }
    const selected = event?.colorContent || "";
    const hasSelectedOption = !selected || (field.options || []).some((option) => option.name === selected);
    const staleOption = selected && !hasSelectedOption ?
        `<option value="${escapeAttr(selected)}" selected disabled>${escapeHtml(selected)}</option>` : "";
    return `<div class="b3-form__space">
        <select class="b3-select fn__block" id="av-event-color" aria-label="${window.siyuan.languages.color || "Color"}"${readOnly ? " disabled" : ""}>
            <option value=""${selected ? "" : " selected"}>${window.siyuan.languages.none || "None"}</option>
            ${staleOption}
            ${(field.options || []).map((option) => `<option value="${escapeAttr(option.name)}"${option.name === selected ? " selected" : ""}>${escapeHtml(option.name)}</option>`).join("")}
        </select>
    </div>`;
};

const getRecurrenceFromDialog = (dialog: Dialog) => {
    const rawInput = dialog.element.querySelector("#av-event-recurrence-raw") as HTMLInputElement;
    if (rawInput) {
        return rawInput.value;
    }
    const preset = (dialog.element.querySelector("#av-event-recurrence-preset") as HTMLSelectElement)?.value as CalendarRecurrencePreset;
    if (preset && preset !== "custom") {
        return getRecurrencePresetRule(preset);
    }
    const freq = (dialog.element.querySelector("#av-event-recurrence-freq") as HTMLSelectElement)?.value;
    if (!freq) {
        return "";
    }
    const interval = getPositiveIntegerInputValue((dialog.element.querySelector("#av-event-recurrence-interval") as HTMLInputElement)?.value || "", 1);
    const endMode = (dialog.element.querySelector('input[name="calendar-recurrence-end"]:checked') as HTMLInputElement)?.value || "never";
    const count = endMode === "count" ? getPositiveIntegerInputValue((dialog.element.querySelector("#av-event-recurrence-count") as HTMLInputElement)?.value || "") : undefined;
    const date = (dialog.element.querySelector("#av-event-date") as HTMLInputElement)?.value;
    const untilInput = endMode === "until" ? (dialog.element.querySelector("#av-event-recurrence-until") as HTMLInputElement)?.value : "";
    const until = untilInput && date && untilInput < date ? date : untilInput;
    const parts = [`FREQ=${freq}`];
    if (interval && interval > 1) {
        parts.push(`INTERVAL=${interval}`);
    }
    if (count && count > 0) {
        parts.push(`COUNT=${count}`);
    }
    if (until) {
        parts.push(`UNTIL=${until}`);
    }
    const byDay = Array.from(dialog.element.querySelectorAll('[data-type="calendar-recurrence-weekday"]:checked'))
        .map(item => (item as HTMLInputElement).value)
        .filter(Boolean);
    if (freq === "WEEKLY" && byDay.length > 0) {
        parts.push(`BYDAY=${byDay.join(",")}`);
    }
    return parts.join(";");
};

export const openEventDialog = (options: IEventDialogOptions): Dialog => {
    const {event, date} = options;
    const isEditing = !!event;
    const readOnly = !!options.readOnly;
    const mapping = getCalendarFieldMapping(options.data.view as IAVCalendar);
    const calendarView = options.data.view as IAVCalendar;
    const colorField = calendarView.fields.find((field) => field.id === mapping.colorFieldID);
    const internalFieldIDs = new Set([mapping.recurrenceFieldID, mapping.exceptionFieldID].filter(Boolean));
    const visibleTextFields = calendarView.fields.filter(field => field.type === "text" && !field.hidden && !internalFieldIDs.has(field.id) && !isCalendarRecurrenceStorageField(field));
    const editsSeries = !!event?.isOccurrence && !mapping.exceptionFieldID;
    const deleteLabel = event?.isOccurrence || isRecurringSourceEvent(event) ?
        (window.siyuan.languages.calendarDeleteRecurring || "Delete recurring item") :
        (window.siyuan.languages.calendarDeleteEvent || "Delete event");
    const disabledAttr = readOnly ? " disabled" : "";
    const draft = options.draft;
    const isAllDay = event?.isAllDay ?? draft?.isAllDay ?? true;
    const startDate = event?.start.format("YYYY-MM-DD") || draft?.date || date;
    const endDate = event?.end?.format("YYYY-MM-DD") || draft?.endDate || startDate;
    const startTime = event?.start.format("HH:mm") || draft?.startTime || "09:00";
    const endTime = event?.end?.format("HH:mm") || draft?.endTime || "10:00";
    const sourceLabel = event?.blockID ? (window.siyuan.languages.calendarSource || "Source note/block") : "";
    // A bound entry keeps its title in the document (the kernel derives the
    // primary key from it), so editing the title here renames the page.
    const documentID = getEventDocumentID(event);
    const content = `<div class="b3-dialog__content av__calendar-dialog">
    <button class="b3-button b3-button--text av__calendar-dialog-close" data-type="event-close" aria-label="${window.siyuan.languages.close || "Close"}">×</button>
    ${!readOnly && editsSeries ? `<div class="b3-form__space ft__on-surface ft__smaller">${window.siyuan.languages.calendarEditSeriesNotice || "This will edit the recurring series. Map an exception field to edit a single occurrence."}</div>` : ""}
    <div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-title" aria-label="${escapeAttr(window.siyuan.languages.title || "Title")}" placeholder="${escapeAttr((event?.isTitleFallback ? event.title : "") || window.siyuan.languages.title || "Title")}" value="${escapeAttr((event?.isTitleFallback ? "" : event?.title) || draft?.title || "")}"${disabledAttr}>
    </div>
    <div class="b3-form__space av__calendar-dialog-schedule${isAllDay ? " av__calendar-dialog-schedule--all-day" : ""}" id="av-event-schedule">
        <div class="av__calendar-dialog-endpoint">
            <label class="av__calendar-dialog-endpoint-label" for="av-event-date">${escapeHtml(window.siyuan.languages.calendarStart || "Start")}</label>
            <div class="av__calendar-dialog-endpoint-fields">
                <input type="date" class="b3-text-field" id="av-event-date" aria-label="${window.siyuan.languages.date || "Date"}" value="${startDate}"${disabledAttr}>
                <input type="time" class="b3-text-field av__calendar-dialog-time" id="av-event-start" value="${startTime}"${disabledAttr}>
            </div>
        </div>
        <div class="av__calendar-dialog-endpoint">
            <label class="av__calendar-dialog-endpoint-label" for="av-event-end-date">${escapeHtml(window.siyuan.languages.calendarEnd || "End")}</label>
            <div class="av__calendar-dialog-endpoint-fields">
                <input type="date" class="b3-text-field" id="av-event-end-date" aria-label="${window.siyuan.languages.endDate || "End date"}" value="${endDate}"${disabledAttr}>
                <input type="time" class="b3-text-field av__calendar-dialog-time" id="av-event-end" value="${endTime}"${disabledAttr}>
            </div>
        </div>
        <label class="fn__flex-center av__calendar-check av__calendar-dialog-all-day">
            <input type="checkbox" id="av-event-allday" ${isAllDay ? "checked" : ""}${disabledAttr}>
            <span>${window.siyuan.languages.allDay || "All day"}</span>
        </label>
    </div>
    ${visibleTextFields.map(field => `<div class="b3-form__space av__calendar-dialog-field" data-type="calendar-custom-field" data-field-id="${escapeAttr(field.id)}">
        <label class="ft__on-surface ft__smaller" for="av-event-field-${escapeAttr(field.id)}">${escapeHtml(field.name)}</label>
        <input class="b3-text-field fn__block" id="av-event-field-${escapeAttr(field.id)}" data-type="calendar-field-value" data-field-id="${escapeAttr(field.id)}" value="${escapeAttr(event?.fieldValues?.[field.id] || draft?.fieldValues?.[field.id] || "")}"${disabledAttr}>
    </div>`).join("")}
    <div class="b3-form__space av__calendar-dialog-field">
        <label class="ft__on-surface ft__smaller" for="av-event-recurrence-preset">${escapeHtml(window.siyuan.languages.calendarRecurrence || "Recurrence")}</label>
        ${renderRecurrenceFields(event, readOnly, startDate)}
    </div>
    ${renderColorField(colorField, event, readOnly)}
    ${event?.blockID ? `<button type="button" class="b3-button b3-button--text b3-form__space av__calendar-event-source" data-type="event-open-block" aria-label="${escapeAttr(window.siyuan.languages.calendarOpenSource || "Open source")}">
        <span class="av__calendar-source" aria-hidden="true">↗</span>
        <span>${escapeHtml(sourceLabel)}</span>
        <code>${escapeHtml(event.blockID)}</code>
    </button>` : ""}
    <div class="b3-dialog__action av__calendar-dialog-footer">
        ${isEditing && !readOnly ? `<div class="av__calendar-dialog-footer-secondary">
            <button class="b3-button b3-button--outline" data-type="event-duplicate">${window.siyuan.languages.duplicate}</button>
            <button class="b3-button b3-button--remove" data-type="event-delete">${deleteLabel}</button>
            ${documentID ? `<button class="b3-button b3-button--remove" data-type="event-delete-page">${escapeHtml(window.siyuan.languages.calendarDeleteEventAndDocument || "Delete event and document")}</button>` : ""}
        </div>` : ""}
        <div class="av__calendar-dialog-footer-primary">
            <button class="b3-button b3-button--cancel" data-type="event-cancel">${window.siyuan.languages.cancel}</button>
            ${readOnly ? "" : `<button class="b3-button" data-type="event-save">${window.siyuan.languages.save}</button>`}
        </div>
    </div>
</div>`;
    const guardedClose = {unbind: undefined as (() => void) | undefined};
    const dialog = new Dialog({
        title: isEditing ? (window.siyuan.languages.calendarEditEvent || "Edit event") : (window.siyuan.languages.newEvent || "New Event"),
        content,
        width: "560px",
        disableClose: true,
        destroyCallback: () => guardedClose.unbind?.(),
    });
    guardedClose.unbind = bindGuardedEventDialogClose(dialog);
    bindFormEvents(dialog, options);
    return dialog;
};

const bindGuardedEventDialogClose = (dialog: Dialog) => {
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.isComposing) {
            return;
        }
        if (window.siyuan.dialogs[window.siyuan.dialogs.length - 1] !== dialog) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        dialog.destroy();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
};

const bindFormEvents = (dialog: Dialog, options: IEventDialogOptions) => {
    const allDayCheckbox = dialog.element.querySelector("#av-event-allday") as HTMLInputElement;
    const schedule = dialog.element.querySelector("#av-event-schedule") as HTMLElement;
    const startTimeInput = dialog.element.querySelector("#av-event-start") as HTMLInputElement;
    const endTimeInput = dialog.element.querySelector("#av-event-end") as HTMLInputElement;
    let rememberedTimedStart = allDayCheckbox.checked ? "09:00" : (startTimeInput.value || "09:00");
    let rememberedTimedEnd = allDayCheckbox.checked ? "10:00" : (endTimeInput.value || "10:00");
    allDayCheckbox?.addEventListener("change", () => {
        if (allDayCheckbox.checked) {
            rememberedTimedStart = startTimeInput.value || rememberedTimedStart;
            rememberedTimedEnd = endTimeInput.value || rememberedTimedEnd;
        } else {
            startTimeInput.value = rememberedTimedStart;
            endTimeInput.value = rememberedTimedEnd;
        }
        schedule?.classList.toggle("av__calendar-dialog-schedule--all-day", allDayCheckbox.checked);
    });
    const dateInput = dialog.element.querySelector("#av-event-date") as HTMLInputElement;
    const endDateInput = dialog.element.querySelector("#av-event-end-date") as HTMLInputElement;
    const recurrenceFreq = dialog.element.querySelector("#av-event-recurrence-freq") as HTMLSelectElement;
    const weekdayRow = dialog.element.querySelector('[data-type="calendar-weekday-row"]') as HTMLElement;
    const presetSelect = dialog.element.querySelector("#av-event-recurrence-preset") as HTMLSelectElement;
    const customRow = dialog.element.querySelector("#av-event-recurrence-custom") as HTMLElement;
    const summaryElement = dialog.element.querySelector("#av-event-recurrence-summary") as HTMLElement;
    const updateRecurrenceSummary = () => {
        if (summaryElement) {
            summaryElement.textContent = describeRecurrence(getRecurrenceFromDialog(dialog), dateInput?.value || options.date);
        }
    };
    dateInput?.addEventListener("change", () => {
        if (!endDateInput.value || endDateInput.value < dateInput.value) {
            endDateInput.value = dateInput.value;
        }
        const recurrenceUntilInput = dialog.element.querySelector("#av-event-recurrence-until") as HTMLInputElement;
        if (recurrenceUntilInput?.value && recurrenceUntilInput.value < dateInput.value) {
            recurrenceUntilInput.value = dateInput.value;
        }
        // "Weekly on Tue" and "Annually on 5 August" are read off the start
        // date, so moving the event has to relabel the presets too.
        if (presetSelect) {
            presetSelect.innerHTML = renderRecurrencePresetOptions(presetSelect.value as CalendarRecurrencePreset, dateInput.value || options.date);
        }
        updateRecurrenceSummary();
    });
    const updateWeekdayVisibility = () => {
        if (weekdayRow) {
            weekdayRow.style.display = recurrenceFreq?.value === "WEEKLY" ? "flex" : "none";
        }
    };
    recurrenceFreq?.addEventListener("change", updateWeekdayVisibility);
    updateWeekdayVisibility();
    const updateRecurrenceEnd = () => {
        const endMode = (dialog.element.querySelector('input[name="calendar-recurrence-end"]:checked') as HTMLInputElement)?.value || "never";
        const untilInput = dialog.element.querySelector("#av-event-recurrence-until") as HTMLInputElement;
        const countInput = dialog.element.querySelector("#av-event-recurrence-count") as HTMLInputElement;
        if (untilInput) untilInput.disabled = !!options.readOnly || endMode !== "until";
        if (countInput) countInput.disabled = !!options.readOnly || endMode !== "count";
        updateRecurrenceSummary();
    };
    dialog.element.querySelectorAll('input[name="calendar-recurrence-end"]').forEach(item => item.addEventListener("change", updateRecurrenceEnd));
    updateRecurrenceEnd();
    let previousPreset = presetSelect?.value as CalendarRecurrencePreset;
    presetSelect?.addEventListener("change", () => {
        const preset = presetSelect.value as CalendarRecurrencePreset;
        if (customRow) {
            customRow.style.display = preset === "custom" ? "" : "none";
        }
        if (shouldResetCustomWeekdays(previousPreset, preset)) {
            dialog.element.querySelectorAll(CALENDAR_RECURRENCE_WEEKDAY_SELECTOR).forEach(item => {
                const checkbox = item as HTMLInputElement;
                checkbox.checked = false;
            });
        }
        if (preset !== "custom") {
            writeRecurrenceRuleToControls(dialog, getRecurrencePresetRule(preset));
        }
        previousPreset = preset;
        updateWeekdayVisibility();
        updateRecurrenceSummary();
    });
    // Editing the escape-hatch controls only refreshes the prose; it must never
    // rewrite them, or the smoke that sets FREQ/INTERVAL/COUNT directly would
    // have its values clobbered.
    [recurrenceFreq,
        dialog.element.querySelector("#av-event-recurrence-interval"),
        dialog.element.querySelector("#av-event-recurrence-count"),
        dialog.element.querySelector("#av-event-recurrence-until"),
        ...Array.from(dialog.element.querySelectorAll(CALENDAR_RECURRENCE_WEEKDAY_SELECTOR)),
    ].forEach(item => item?.addEventListener("change", updateRecurrenceSummary));
    dialog.element.querySelector('[data-type="event-cancel"]')?.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="event-close"]')?.addEventListener("click", () => dialog.destroy());
    if (options.readOnly) {
        dialog.element.querySelector('[data-type="event-open-block"]')?.addEventListener("click", () => openEventBlock(dialog, options));
        return;
    }
    dialog.element.querySelector('[data-type="event-save"]')?.addEventListener("click", () => runRecurringEventAction(dialog, options, "edit", (scope) => withPendingSave(dialog, "event-save", () => saveEventWithScope(dialog, options, scope))));
    dialog.element.querySelector('[data-type="event-delete"]')?.addEventListener("click", () => runRecurringEventAction(dialog, options, "delete", (scope) => withCalendarDialogOperationFeedback(dialog, "event-delete", window.siyuan.languages.calendarDeleteFailed || "Delete failed.", () => deleteEventWithScope(dialog, options, scope))));
    dialog.element.querySelector('[data-type="event-delete-page"]')?.addEventListener("click", () => withCalendarDialogOperationFeedback(dialog, "event-delete-page", window.siyuan.languages.calendarDeleteFailed || "Delete failed.", () => deleteEventWithPage(dialog, options)));
    dialog.element.querySelector('[data-type="event-duplicate"]')?.addEventListener("click", () => withCalendarDialogOperationFeedback(dialog, "event-duplicate", window.siyuan.languages.calendarDuplicateFailed || "Duplicate failed.", () => duplicateEvent(dialog, options)));
    dialog.element.querySelector('[data-type="event-open-block"]')?.addEventListener("click", () => openEventBlock(dialog, options));
    dialog.element.querySelector("#av-event-title")?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            runRecurringEventAction(dialog, options, "edit", (scope) => withPendingSave(dialog, "event-save", () => saveEventWithScope(dialog, options, scope)));
        }
    });
};

const openEventBlock = (dialog: Dialog, options: IEventDialogOptions) => {
    const blockID = options.event?.blockID;
    if (!blockID) {
        return;
    }
    /// #if !MOBILE
    openFileById({
        app: options.protyle.app,
        id: blockID,
        action: [Constants.CB_GET_FOCUS],
    });
    /// #else
    openMobileFileById(options.protyle.app, blockID, [Constants.CB_GET_FOCUS]);
    /// #endif
    dialog.destroy();
};

const getDraftFromDialog = (dialog: Dialog) => {
    const date = (dialog.element.querySelector("#av-event-date") as HTMLInputElement).value;
    const endDateInput = (dialog.element.querySelector("#av-event-end-date") as HTMLInputElement).value;
    const endDate = isRealDateInputValue(endDateInput) && endDateInput >= date ? endDateInput : date;
    const fieldValues: { [fieldID: string]: string } = {};
    dialog.element.querySelectorAll('[data-type="calendar-field-value"]').forEach(item => {
        const input = item as HTMLInputElement;
        if (input.dataset.fieldId) {
            fieldValues[input.dataset.fieldId] = input.value;
        }
    });
    return {
        title: (dialog.element.querySelector("#av-event-title") as HTMLInputElement).value.trim(),
        date,
        endDate,
        isAllDay: (dialog.element.querySelector("#av-event-allday") as HTMLInputElement).checked,
        startTime: (dialog.element.querySelector("#av-event-start") as HTMLInputElement).value || "09:00",
        endTime: (dialog.element.querySelector("#av-event-end") as HTMLInputElement).value || "10:00",
        recurrenceRaw: getRecurrenceFromDialog(dialog),
        colorContent: (dialog.element.querySelector("#av-event-color") as HTMLSelectElement)?.value || "",
        fieldValues,
    };
};

const getEventScheduleDraft = (event: ICalendarNormalizedEvent) => ({
    date: event.start.format("YYYY-MM-DD"),
    endDate: (event.end || event.start).format("YYYY-MM-DD"),
    isAllDay: event.isAllDay,
    startTime: event.start.format("HH:mm"),
    endTime: (event.end || event.start.add(1, "hour")).format("HH:mm"),
});

export const getWholeSeriesDraft = (
    draft: ICalendarEventDraft,
    selectedEvent?: ICalendarNormalizedEvent,
    seriesEvent?: ICalendarNormalizedEvent,
): ICalendarEventDraft => {
    if (!selectedEvent?.isOccurrence || !seriesEvent) {
        return draft;
    }
    return {...draft, ...getEventScheduleDraft(seriesEvent)};
};

const withPendingSave = (dialog: Dialog, saveType: string, callback: () => Promise<boolean>) => withCalendarDialogOperationFeedback(dialog, saveType, window.siyuan.languages.calendarSaveFailed || "Save failed.", callback);

const withCalendarDialogOperationFeedback = async (dialog: Dialog, actionType: string, failureMessage: string, callback: () => Promise<boolean>) => {
    const actionButton = dialog.element.querySelector(`[data-type="${actionType}"]`) as HTMLButtonElement;
    if (actionButton?.disabled || dialog.element.dataset.calendarOperation === "pending") {
        return;
    }
    dialog.element.dataset.calendarOperation = "pending";
    dialog.element.setAttribute("aria-busy", "true");
    dialog.element.classList.add("av__calendar-dialog--pending");
    if (actionButton) {
        actionButton.disabled = true;
    }
    try {
        const saved = await callback();
        if (!saved && actionButton) {
            actionButton.disabled = false;
            showMessage(failureMessage);
        }
    } catch (error) {
        if (actionButton) {
            actionButton.disabled = false;
        }
        showMessage(failureMessage);
    } finally {
        delete dialog.element.dataset.calendarOperation;
        dialog.element.removeAttribute("aria-busy");
        dialog.element.classList.remove("av__calendar-dialog--pending");
    }
};

const showInvalidDraftMessage = (draft: ReturnType<typeof getDraftFromDialog>, mapping: ReturnType<typeof getCalendarFieldMapping>, allowEmptyTitle = false) => {
    if (!draft.title && !allowEmptyTitle) {
        showMessage(`${window.siyuan.languages.title || "Title"} ${window.siyuan.languages.invalid || "Invalid"}`);
        return;
    }
    if (!isRealDateInputValue(draft.date)) {
        showMessage(`${window.siyuan.languages.date || "Date"} ${window.siyuan.languages.invalid || "Invalid"}`);
        return;
    }
    if (!mapping.dateFieldID) {
        showMessage(window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field");
        return;
    }
    showMessage(window.siyuan.languages._kernel[258]);
};

export const isRecurringSourceEvent = (event?: ICalendarNormalizedEvent) => {
    if (!event || event.isOccurrence) {
        return false;
    }
    // recurrenceRaw "None" explicitly means non-recurring; only treat other
    // non-empty raw rules (including advanced ones we keep verbatim) as recurring.
    const raw = (event.recurrenceRaw || "").trim();
    return !!event.recurrence || (!!raw && raw.toUpperCase() !== "NONE");
};

export const getDisabledRecurrenceScopes = (mapping: ReturnType<typeof getCalendarFieldMapping>, action: "edit" | "delete", event?: ICalendarNormalizedEvent) => {
    const isSourceEvent = isRecurringSourceEvent(event);
    return {
        occurrence: isSourceEvent ?
            (window.siyuan.languages.calendarRecurrenceScopeRootOccurrenceDisabled || "This source event stores the recurring series. Single-occurrence changes are only available from generated occurrences.") :
            (mapping.exceptionFieldID ? "" : (window.siyuan.languages.calendarRecurrenceScopeOccurrenceDisabled || "Map an exception field to change only this occurrence.")),
        future: isSourceEvent ?
            (window.siyuan.languages.calendarRecurrenceScopeRootFutureDisabled || "This option is only available from a later occurrence.") :
            (mapping.recurrenceFieldID ? "" :
                (window.siyuan.languages.calendarRecurrenceScopeFutureDisabled || "Map a recurrence field to change this and following items.")),
    };
};

export const openRecurrenceScopeDialog = (options: {
    action: "edit" | "delete" | "move" | "resize";
    disabledScopes: Partial<Record<CalendarRecurrenceScope, string>>;
    onSelect: (scope: CalendarRecurrenceScope) => void;
}) => {
    const isGerman = /^de(?:-|$)/i.test(window.siyuan.config.lang || "");
    const seriesTitle = options.action === "delete" ?
        (isGerman ? "Alle löschen" : (window.siyuan.languages.calendarDeleteSeries || "Delete all")) :
        (isGerman ? "Alle bearbeiten" : (window.siyuan.languages.calendarRecurrenceScopeSeries || window.siyuan.languages.all || "All"));
    const title = options.action === "delete" ?
        (window.siyuan.languages.calendarRecurrenceScopeDeleteTitle || "Delete recurring item") :
        (window.siyuan.languages.calendarRecurrenceScopeEditTitle || "Edit recurring item");
    const labels: Array<{scope: CalendarRecurrenceScope, title: string, description: string}> = [
        {scope: "occurrence", title: window.siyuan.languages.calendarRecurrenceScopeOccurrence || "This occurrence", description: window.siyuan.languages.calendarRecurrenceScopeOccurrenceDesc || "Only the selected occurrence."},
        {scope: "future", title: window.siyuan.languages.calendarThisAndFuture || "This and future", description: window.siyuan.languages.calendarRecurrenceScopeFutureDesc || "This occurrence and following items in the series."},
        {scope: "series", title: seriesTitle, description: window.siyuan.languages.calendarRecurrenceScopeSeriesDesc || "Every item in the recurring series."},
    ];
    const availableLabels = labels.filter(item => !options.disabledScopes[item.scope]);
    if (availableLabels.length === 1 && options.action !== "delete") {
        options.onSelect(availableLabels[0].scope);
        return;
    }
    const isSingleDelete = availableLabels.length === 1 && options.action === "delete";
    const dialog = new Dialog({
        title,
        width: "420px",
        content: `<div class="b3-dialog__content av__calendar-scope">
    ${isSingleDelete ? "" : `<div class="ft__on-surface b3-form__space">${window.siyuan.languages.calendarRecurrenceScopePrompt || "Choose how far this change should apply."}</div>
    ${availableLabels.map(item => `<button class="b3-button b3-button--outline av__calendar-scope-option" data-type="calendar-scope-${item.scope}">
            <span class="av__calendar-scope-title">${escapeHtml(item.title)}</span>
            <span class="av__calendar-scope-desc">${escapeHtml(item.description)}</span>
        </button>`).join("")}`}
    <div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-type="calendar-scope-cancel">${window.siyuan.languages.cancel}</button>${isSingleDelete ? `<span class="fn__space"></span><button class="b3-button b3-button--remove" data-type="calendar-scope-${availableLabels[0].scope}">${escapeHtml(availableLabels[0].title)}</button>` : ""}</div>
</div>`,
    });
    availableLabels.forEach(item => {
        dialog.element.querySelector(`[data-type="calendar-scope-${item.scope}"]`)?.addEventListener("click", () => {
            dialog.destroy();
            options.onSelect(item.scope);
        });
    });
    dialog.element.querySelector('[data-type="calendar-scope-cancel"]')?.addEventListener("click", () => dialog.destroy());
    (dialog.element.querySelector(".av__calendar-scope-option:not([disabled])") as HTMLButtonElement)?.focus();
    return dialog;
};

const runRecurringEventAction = (dialog: Dialog, options: IEventDialogOptions, action: "edit" | "delete", run: (scope: CalendarRecurrenceScope) => void) => {
    if (!options.event || (!options.event.isOccurrence && !isRecurringSourceEvent(options.event))) {
        run("series");
        return;
    }
    const mapping = getCalendarFieldMapping(options.data.view as IAVCalendar);
    openRecurrenceScopeDialog({
        action,
        disabledScopes: getDisabledRecurrenceScopes(mapping, action, options.event),
        onSelect: run,
    });
};

const ensureRecurrenceStorage = (
    options: IEventDialogOptions,
    calendarData: IAVCalendar,
    mapping: ReturnType<typeof getCalendarFieldMapping>,
    recurrenceRaw = "",
) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const viewID = getViewID(options);
    if (!avID || !blockID || !viewID) {
        return Promise.resolve(mapping);
    }
    return ensureCalendarRecurrenceStorage({
        protyle: options.protyle,
        calendarData,
        mapping,
        avID,
        blockID,
        viewID,
        storageRequired: Boolean(recurrenceRaw),
    });
};

const saveEventWithScope = async (dialog: Dialog, options: IEventDialogOptions, scope: CalendarRecurrenceScope) => {
    if (scope === "future") {
        return saveFutureEvent(dialog, options);
    }
    return saveEvent(dialog, options, scope);
};

const deleteEventWithScope = async (dialog: Dialog, options: IEventDialogOptions, scope: CalendarRecurrenceScope) => deleteEvent(dialog, options, scope);

/**
 * One new entry. When the view creates entries as documents this goes through the
 * kernel (only it can create the .sy file and bind it in one transaction);
 * otherwise it stays the detached row-only path.
 */
const createEntryFromDraft = async (options: IEventDialogOptions, args: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ReturnType<typeof getCalendarFieldMapping>;
    draft: ICalendarEventDraft;
}) => {
    const createOptions = {
        protyle: options.protyle,
        avID: args.avID,
        blockID: args.blockID,
        viewID: getViewID(options),
        dateFieldID: args.dateFieldID,
        fields: args.fields,
        mapping: args.mapping,
        draft: args.draft,
        templateID: options.templateID,
        previousUpdated: options.blockElement.getAttribute("updated") || "",
    };
    if (options.createAsDocument) {
        return !!await createCalendarEventAsDocument(createOptions);
    }
    return createCalendarEvent(createOptions);
};

const saveEvent = async (dialog: Dialog, options: IEventDialogOptions, scope: CalendarRecurrenceScope = "series") => {
    const calendarData = options.data.view as IAVCalendar;
    const draft = getDraftFromDialog(dialog);
    const initialMapping = getCalendarFieldMapping(calendarData);
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if ((!draft.title && !options.event?.isTitleFallback) || !isRealDateInputValue(draft.date) || !avID || !blockID || !initialMapping.dateFieldID) {
        showInvalidDraftMessage(draft, initialMapping, Boolean(options.event?.isTitleFallback));
        return false;
    }
    const mapping = await ensureRecurrenceStorage(options, calendarData, initialMapping, draft.recurrenceRaw);
    if (options.event) {
        if (scope === "occurrence" && options.event.isOccurrence && mapping.exceptionFieldID) {
            if (!await createCalendarEventReplacingOccurrence({
                protyle: options.protyle,
                avID,
                blockID,
                dateFieldID: mapping.dateFieldID,
                fields: calendarData.fields,
                mapping,
                event: options.event,
                draft,
                occurrenceDate: options.event.start.format("YYYY-MM-DD"),
                previousUpdated: options.blockElement.getAttribute("updated") || "",
                viewID: getViewID(options),
                createAsDocument: options.createAsDocument,
                templateID: options.templateID,
            })) {
                return false;
            }
            dialog.destroy();
            options.onSave?.();
            return true;
        }
        const eventToUpdate = scope === "series" ? (options.seriesEvent || options.event) : options.event;
        const draftToUpdate = scope === "series" ? getWholeSeriesDraft(draft, options.event, options.seriesEvent) : draft;
        if (!await updateCalendarEvent({
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendarData.fields,
            mapping,
            event: eventToUpdate,
            draft: draftToUpdate,
            viewID: getViewID(options),
            previousUpdated: options.blockElement.getAttribute("updated") || "",
            })) {
            return false;
        }
    } else if (!await createEntryFromDraft(options, {
        avID,
        blockID,
        dateFieldID: mapping.dateFieldID,
        fields: calendarData.fields,
        mapping,
        draft,
    })) {
        return false;
    }
    dialog.destroy();
    options.onSave?.();
    return true;
};

const saveFutureEvent = async (dialog: Dialog, options: IEventDialogOptions) => {
    const calendarData = options.data.view as IAVCalendar;
    const draft = getDraftFromDialog(dialog);
    const initialMapping = getCalendarFieldMapping(calendarData);
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!options.event || !options.event.isOccurrence || (!draft.title && !options.event.isTitleFallback) || !isRealDateInputValue(draft.date) || !avID || !blockID || !initialMapping.dateFieldID) {
        showInvalidDraftMessage(draft, initialMapping, Boolean(options.event?.isTitleFallback));
        return false;
    }
    const mapping = await ensureRecurrenceStorage(options, calendarData, initialMapping, draft.recurrenceRaw);
    if (!mapping.recurrenceFieldID) {
        showInvalidDraftMessage(draft, mapping, Boolean(options.event?.isTitleFallback));
        return false;
    }
    if (!await updateCalendarEventThisAndFuture({
        protyle: options.protyle,
        avID,
        blockID,
        dateFieldID: mapping.dateFieldID,
        fields: calendarData.fields,
        mapping,
        event: options.event,
        draft,
        occurrenceDate: options.event.start.format("YYYY-MM-DD"),
        previousUpdated: options.blockElement.getAttribute("updated") || "",
        viewID: getViewID(options),
        createAsDocument: options.createAsDocument,
        templateID: options.templateID,
    })) {
        return false;
    }
    dialog.destroy();
    options.onSave?.();
    return true;
};

const duplicateEvent = async (dialog: Dialog, options: IEventDialogOptions) => {
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    const currentDraft = getDraftFromDialog(dialog);
    const draft = {
        ...currentDraft,
        recurrenceRaw: "",
        recurrenceExceptionRaw: "",
    };
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if ((!draft.title && !options.event?.isTitleFallback) || !isRealDateInputValue(draft.date) || !avID || !blockID || !mapping.dateFieldID) {
        showInvalidDraftMessage(draft, mapping, Boolean(options.event?.isTitleFallback));
        return false;
    }
    if (!await createEntryFromDraft(options, {
        avID,
        blockID,
        dateFieldID: mapping.dateFieldID,
        fields: calendarData.fields,
        mapping,
        draft,
    })) {
        return false;
    }
    dialog.destroy();
    options.onSave?.();
    return true;
};

const deleteEventWithPage = async (dialog: Dialog, options: IEventDialogOptions) => {
    const documentID = getEventDocumentID(options.event);
    if (!documentID) {
        return false;
    }
    // The row removal runs FIRST: a page must never be destroyed for a row
    // removal that did not land.
    if (!await deleteEvent(dialog, options, "series")) {
        return false;
    }
    // The row is already gone, so a failing page removal is not a failed delete -
    // deleteCalendarEventDocument has shown why the page survived.
    await deleteCalendarEventDocument(documentID);
    return true;
};

const deleteEvent = async (dialog: Dialog, options: IEventDialogOptions, scope: CalendarRecurrenceScope = "series") => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!options.event || !avID || !blockID) {
        return false;
    }
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    if (scope === "occurrence" && options.event.isOccurrence && mapping.exceptionFieldID) {
        if (!await deleteCalendarOccurrence({
            protyle: options.protyle,
            avID,
            blockID,
            fields: calendarData.fields,
            mapping,
            event: options.event,
            occurrenceDate: options.event.start.format("YYYY-MM-DD"),
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        })) {
            return false;
        }
        dialog.destroy();
        options.onDelete?.();
        return true;
    }
    if (scope === "future" && mapping.recurrenceFieldID) {
        if (!await deleteCalendarEventThisAndFuture({
            protyle: options.protyle,
            avID,
            blockID,
            fields: calendarData.fields,
            mapping,
            event: options.event,
            occurrenceDate: options.event.start.format("YYYY-MM-DD"),
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        })) {
            return false;
        }
        dialog.destroy();
        options.onDelete?.();
        return true;
    }
    if (!await deleteCalendarEvent({
        protyle: options.protyle,
        avID,
        blockID,
        event: options.event,
        previousUpdated: options.blockElement.getAttribute("updated") || "",
    })) {
        return false;
    }
    dialog.destroy();
    options.onDelete?.();
    return true;
};
