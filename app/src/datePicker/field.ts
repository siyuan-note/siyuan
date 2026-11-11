import {addDays, addMonths, candidateForDay, dateToDays, daysToDate, formatDate, ICivilDate,
    IDateConstraints, localToday, parseDate, validateDateValue, weekday} from "./model";

export const createDateField = (host: HTMLElement, options: IDateConstraints & {
    value: string;
    locale?: string;
    initialBadInput?: boolean;
    languages: Record<string, string>;
    onStateChange?: () => void;
    onSelect?: () => void;
}) => {
    const doc = host.ownerDocument;
    const lang = options.languages;
    const touch = doc.getElementById("sidebar") ? "--touch" : "";
    let disposed = false;
    let badInput = !!options.initialBadInput;
    let locale: string;
    try { locale = new Intl.Locale(options.locale || doc.documentElement.lang || doc.defaultView.navigator.language).toString(); }
    catch { locale = "en"; }
    const localeInfo = new Intl.Locale(locale) as Intl.Locale & {getWeekInfo?: () => {firstDay: number}; weekInfo?: {firstDay: number}};
    const weekStart = (localeInfo.getWeekInfo?.() || localeInfo.weekInfo)?.firstDay % 7 || 0;
    const monthFormatter = new Intl.DateTimeFormat(locale, {month: "long", calendar: "gregory", timeZone: "UTC"});
    const weekdayFormatter = new Intl.DateTimeFormat(locale, {weekday: "short", timeZone: "UTC"});
    const narrowWeekdayFormatter = new Intl.DateTimeFormat(locale, {weekday: "narrow", timeZone: "UTC"});
    const fullWeekdayFormatter = new Intl.DateTimeFormat(locale, {weekday: "long", timeZone: "UTC"});
    const dateFormatter = new Intl.DateTimeFormat(locale, {dateStyle: "full", calendar: "gregory", timeZone: "UTC"});
    const headingFormatter = new Intl.DateTimeFormat(locale, {month: "long", year: "numeric", calendar: "gregory", timeZone: "UTC"});
    const numberFormatter = new Intl.NumberFormat(locale, {useGrouping: false});
    const labelDate = (date: ICivilDate) => {
        const time = dateToDays(date) * 86400000;
        return Math.abs(time) <= 8640000000000000 ? dateFormatter.format(time) : formatDate(date);
    };
    const root = doc.createElement("div");
    root.className = "date-picker";
    if (Array.from({length: 7}, (_, day) => weekdayFormatter.format(Date.UTC(2024, 0, 7 + day)))
        .some(label => Array.from(label).length > 3)) {
        root.classList.add("date-picker--narrow-weekdays");
    }
    const fields = doc.createElement("div");
    fields.className = "date-picker__fields";
    const composing = new Set<HTMLInputElement>();
    const error = doc.createElement("div");
    error.className = "ft__error";
    error.id = "date-picker-error-" + Math.random().toString(36).substring(2);
    error.setAttribute("role", "status");
    const createInput = (label: string, placeholder: string) => {
        const wrapper = doc.createElement("label");
        wrapper.className = "date-picker__field";
        const text = doc.createElement("span");
        text.textContent = label;
        const input = doc.createElement("input");
        input.type = "text";
        input.className = "b3-text-field" + (touch ? " b3-text-field" + touch : "");
        input.placeholder = placeholder;
        input.dir = "ltr";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("aria-describedby", error.id);
        wrapper.append(text, input);
        fields.append(wrapper);
        return input;
    };
    const dateInput = options.type === "time" ? undefined : createInput(lang.date, "YYYY-MM-DD");
    const timeInput = options.type === "date" ? undefined : createInput(lang.datePickerTime, "HH:mm[:ss[.SSS]]");
    const inputs = [dateInput, timeInput].filter((input): input is HTMLInputElement => !!input);
    const probe = doc.createElement("input");
    probe.type = options.type;
    probe.min = options.min || "";
    probe.max = options.max || "";
    probe.step = options.step || "";
    probe.required = !!options.required;
    probe.setAttribute("value", options.stepBase || "");
    const readValue = () => options.type === "date" ? dateInput.value : options.type === "time" ? timeInput.value :
        !dateInput.value && !timeInput.value ? "" : `${dateInput.value}T${timeInput.value}`;
    const setValue = (value: string) => {
        if (dateInput) { dateInput.value = value.split("T")[0]; }
        if (timeInput) { timeInput.value = options.type === "time" ? value : value.split("T")[1] || ""; }
    };
    setValue(options.value);
    const validate = () => {
        const value = readValue();
        probe.value = value;
        return !disposed && !badInput && !composing.size && validateDateValue(value, options) === "valid" &&
            (value === "" || probe.value !== "") && probe.validity.valid;
    };
    const notify = (showError = false) => {
        const valid = validate();
        if (showError || error.textContent) {
            error.textContent = valid ? "" : probe.validationMessage || lang.invalid;
        }
        inputs.forEach(input => input.setAttribute("aria-invalid", String(!valid)));
        options.onStateChange?.();
    };
    let focusDate = parseDate(options.value.split("T")[0]) || localToday();
    const minDate = parseDate((options.min || "").split(/[T ]/)[0]);
    const maxDate = parseDate((options.max || "").split(/[T ]/)[0]);
    if (minDate && dateToDays(focusDate) < dateToDays(minDate)) { focusDate = minDate; }
    if (maxDate && dateToDays(focusDate) > dateToDays(maxDate)) { focusDate = maxDate; }
    let month = {...focusDate, day: 1};
    const toolbar = doc.createElement("div");
    toolbar.className = "date-picker__navigation";
    const makeButton = (label: string, className = "b3-button b3-button--cancel") => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        return button;
    };
    const previous = makeButton(lang.previous, "block__icon");
    previous.setAttribute("aria-label", lang.previous);
    previous.innerHTML = '<svg><use xlink:href="#iconLeft"></use></svg>';
    const next = makeButton(lang.next, "block__icon");
    next.setAttribute("aria-label", lang.next);
    next.innerHTML = '<svg><use xlink:href="#iconRight"></use></svg>';
    const months = doc.createElement("select");
    months.className = "b3-select" + (touch ? " b3-select" + touch : "");
    months.setAttribute("aria-label", lang.month);
    for (let i = 0; i < 12; i++) {
        const option = doc.createElement("option");
        option.value = String(i + 1);
        option.textContent = monthFormatter.format(Date.UTC(2024, i, 1));
        months.append(option);
    }
    const year = doc.createElement("input");
    year.type = "number";
    year.className = "b3-text-field" + (touch ? " b3-text-field" + touch : "");
    year.setAttribute("aria-label", lang.year);
    year.min = "1";
    year.max = "275760";
    year.step = "1";
    toolbar.append(previous, months, year, next);
    const calendar = doc.createElement("table");
    calendar.className = "date-picker__calendar";
    calendar.setAttribute("role", "grid");
    const caption = doc.createElement("caption");
    caption.className = "date-picker__heading";
    caption.setAttribute("aria-live", "polite");
    calendar.append(caption);
    const heading = calendar.createTHead().insertRow();
    for (let i = 0; i < 7; i++) {
        const cell = doc.createElement("th");
        cell.scope = "col";
        const day = Date.UTC(2024, 0, 7 + (weekStart + i) % 7);
        cell.setAttribute("aria-label", fullWeekdayFormatter.format(day));
        cell.title = fullWeekdayFormatter.format(day);
        const short = doc.createElement("span");
        short.className = "date-picker__weekday-short";
        short.textContent = weekdayFormatter.format(day);
        short.setAttribute("aria-hidden", "true");
        const narrow = doc.createElement("span");
        narrow.className = "date-picker__weekday-narrow";
        narrow.textContent = narrowWeekdayFormatter.format(day);
        narrow.setAttribute("aria-hidden", "true");
        cell.append(short, narrow);
        heading.append(cell);
    }
    const body = calendar.createTBody();
    const candidate = (date: ICivilDate) => candidateForDay(date, options, timeInput?.value || "00:00");
    const selectDay = (date: ICivilDate) => {
        if (disposed || composing.size) { return; }
        const value = candidate(date);
        if (value === undefined) { return; }
        badInput = false;
        setValue(value);
        focusDate = date;
        month = {...date, day: 1};
        render(true);
        notify();
        options.onSelect?.();
    };
    const render = (focus = false) => {
        if (!dateInput || disposed) { return; }
        months.value = String(month.month);
        year.value = String(month.year);
        caption.textContent = headingFormatter.format(dateToDays(month) * 86400000);
        calendar.setAttribute("aria-label", caption.textContent);
        previous.disabled = month.year === 1 && month.month === 1;
        next.disabled = month.year === 275760 && month.month >= 9;
        const start = dateToDays(month) - ((weekday(month) - weekStart + 7) % 7);
        const selectedDate = parseDate(dateInput.value);
        const selectedValue = selectedDate && formatDate(selectedDate);
        body.replaceChildren();
        let tabStop: HTMLButtonElement;
        let fallback: HTMLButtonElement;
        for (let row = 0; row < 6; row++) {
            const tr = body.insertRow();
            for (let col = 0; col < 7; col++) {
                const cell = tr.insertCell();
                const serial = start + row * 7 + col;
                if (serial < dateToDays({year: 1, month: 1, day: 1}) || serial > dateToDays({year: 275760, month: 9, day: 13})) { continue; }
                const date = daysToDate(serial);
                const value = formatDate(date);
                const selected = value === selectedValue;
                const today = value === formatDate(localToday());
                cell.setAttribute("aria-selected", String(selected));
                const button = makeButton(numberFormatter.format(date.day), "b3-button" + (selected ? "" : today ? " b3-button--outline" : " b3-button--cancel") +
                    (date.month !== month.month ? " ft__secondary" : ""));
                button.dataset.date = value;
                button.setAttribute("aria-label", labelDate(date));
                if (today) { button.setAttribute("aria-current", "date"); }
                button.setAttribute("aria-disabled", String(candidate(date) === undefined));
                button.tabIndex = -1;
                if (value === formatDate(focusDate)) { tabStop = button; }
                if (!fallback || selected) { fallback = button; }
                button.addEventListener("click", () => selectDay(date));
                button.addEventListener("keydown", event => {
                    const rtl = doc.defaultView.getComputedStyle(root).direction === "rtl";
                    let target: ICivilDate;
                    if (event.key === "ArrowLeft") { target = addDays(date, rtl ? 1 : -1); }
                    else if (event.key === "ArrowRight") { target = addDays(date, rtl ? -1 : 1); }
                    else if (event.key === "ArrowUp") { target = addDays(date, -7); }
                    else if (event.key === "ArrowDown") { target = addDays(date, 7); }
                    else if (event.key === "Home") { target = addDays(date, -((weekday(date) - weekStart + 7) % 7)); }
                    else if (event.key === "End") { target = addDays(date, 6 - ((weekday(date) - weekStart + 7) % 7)); }
                    else if (event.key === "PageUp") { target = addMonths(date, event.shiftKey ? -12 : -1); }
                    else if (event.key === "PageDown") { target = addMonths(date, event.shiftKey ? 12 : 1); }
                    if (!target) { return; }
                    event.preventDefault();
                    event.stopPropagation();
                    focusDate = target;
                    month = {...target, day: 1};
                    render(true);
                });
                cell.append(button);
            }
        }
        const target = tabStop || fallback;
        if (target) {
            target.tabIndex = 0;
            if (focus) { target.focus({preventScroll: true}); }
        } else if (focus) { months.focus({preventScroll: true}); }
    };
    previous.addEventListener("click", () => { month = addMonths(month, -1); focusDate = month; render(); });
    next.addEventListener("click", () => { month = addMonths(month, 1); focusDate = month; render(); });
    const navigate = () => {
        if (!year.value || !year.validity.valid) { return; }
        month = {year: Number(year.value), month: Number(months.value), day: 1};
        if (month.year === 275760 && month.month > 9) { month.month = 9; }
        focusDate = month;
        render();
    };
    months.addEventListener("change", navigate);
    year.addEventListener("change", navigate);
    year.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation();
            if (!year.reportValidity()) { return; }
            navigate();
        }
    });
    inputs.forEach(input => {
        input.addEventListener("compositionstart", () => { composing.add(input); notify(); });
        input.addEventListener("compositionend", () => { composing.delete(input); badInput = false; notify(true); render(); });
        input.addEventListener("input", () => {
            if (composing.has(input)) { return; }
            badInput = false;
            const date = dateInput && parseDate(dateInput.value);
            if (date) { focusDate = date; month = {...date, day: 1}; }
            render();
            notify(true);
        });
    });
    const shortcuts = doc.createElement("div");
    shortcuts.className = "date-picker__shortcuts";
    const today = makeButton(lang.calendarToday);
    today.disabled = !dateInput || candidate(localToday()) === undefined;
    today.addEventListener("click", () => selectDay(localToday()));
    const clear = makeButton(lang.clear);
    clear.disabled = !!options.required;
    clear.addEventListener("click", () => {
        if (composing.size || disposed) { return; }
        badInput = false;
        setValue(""); render(); notify(); inputs[0].focus();
        options.onSelect?.();
    });
    if (dateInput) { shortcuts.append(today); }
    shortcuts.append(clear);
    root.append(fields);
    if (dateInput) { root.append(toolbar, calendar); }
    root.append(shortcuts, error);
    host.append(root);
    render();
    notify();
    const focusTarget = () => calendar.querySelector<HTMLButtonElement>('button[tabindex="0"]') || inputs[0];
    return {
        element: root,
        validate,
        commit: (): string | undefined => {
            if (!validate()) { notify(true); (Array.from(composing)[0] || inputs.find(input => !input.value) || inputs[0]).focus(); return; }
            return probe.value;
        },
        focusTarget,
        focus: () => focusTarget().focus({preventScroll: true}),
        destroy: () => { disposed = true; root.remove(); },
    };
};
