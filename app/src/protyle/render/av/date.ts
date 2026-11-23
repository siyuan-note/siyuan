import dayjs from "dayjs";
import {genCellValueByElement, updateCellsValue} from "./cell";
import {getFieldsByData} from "./view";
import {shouldSubmitDateEdit} from "./dateSubmit";
import {bindLunarDateEvent, getLunarDateHTML} from "./lunarDate";
import {bindInlineDatePicker, getInlineDateType, getInlineDateValue, setInlineDateValue, validateInlineDateInput} from "../../../datePicker/inline";
import {addDays, addMonths, formatDate, parseDate} from "../../../datePicker/model";

export const getDateHTML = (cellElements: HTMLElement[], format?: TAVDateFormat) => {
    const cellValue = genCellValueByElement("date", cellElements[0]).date;
    if ((format ?? cellElements[0].dataset.dateFormat) === "lunar") {
        return getLunarDateHTML(cellValue);
    }
    const isNotTime = cellValue.isNotTime;
    let value = "";
    const currentDate = Date.now();
    if (cellValue.isNotEmpty) {
        value = dayjs(cellValue.content).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
        const year = value.split("-")[0];
        if (year.length !== 4) {
            value = new Array(4 - year.length).fill(0).join("") + value;
        }
    } else {
        value = dayjs(currentDate).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    let value2 = "";
    const hasEndValue = cellValue.isNotEmpty2 && !!cellValue.content2;
    if (hasEndValue) {
        value2 = dayjs(cellValue.content2).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
        const year = value2.split("-")[0];
        if (year.length !== 4) {
            value2 = new Array(4 - year.length).fill(0).join("") + value2;
        }
    } else if (cellValue.hasEndDate) {
        value2 = value;
    }
    const originalEnd = hasEndValue ? cellValue.content2 : cellValue.hasEndDate && cellValue.isNotEmpty ? cellValue.content : "";
    const endWithTime = hasEndValue ? dayjs(cellValue.content2).format("YYYY-MM-DD HH:mm") :
        cellValue.hasEndDate ? dayjs(cellValue.content || currentDate).format("YYYY-MM-DD HH:mm") : "";
    return `<div class="b3-menu__items">
<div>
    <label class="date-picker__endpoint"><span class="ft__smaller">${window.siyuan.languages.startDate}</span>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value}" data-original-timestamp="${cellValue.isNotEmpty ? cellValue.content : ""}" data-value="${dayjs(cellValue.content || currentDate).format("YYYY-MM-DD HH:mm")}" class="b3-text-field"></label>
    <label class="date-picker__endpoint${cellValue.hasEndDate ? "" : " fn__none"}"><span class="ft__smaller">${window.siyuan.languages.endDate}</span>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value2}" data-original-timestamp="${originalEnd}" data-value="${endWithTime}" class="b3-text-field${cellValue.hasEndDate ? "" : " fn__none"}"></label>
    <button class="b3-menu__separator"></button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.endDate}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch b3-switch--menu"${cellValue.hasEndDate ? " checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.includeTime}</span>
        <span class="fn__space fn__flex-1"></span>
        <input type="checkbox" class="b3-switch b3-switch--menu"${isNotTime ? "" : " checked"}>
    </label>
    <button class="b3-menu__separator"></button>
    <div data-date-inline></div>
    <button class="b3-menu__item" data-type="clearDate">
        <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.clear}</span>
    </button>
</div>
</div>`;
};

const normalizeDateDraft = (value: string) => {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value) ||
        /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value) ||
        /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(value) ||
        /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value) ||
        /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match) { return value; }
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const editDateSegment = (input: HTMLInputElement, event: KeyboardEvent) => {
    if (input.type !== "text" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !/^(?:Arrow(?:Up|Down|Left|Right)|\d)$/.test(event.key)) { return; }
    const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(input.value);
    if (!match) { return; }
    const parts = match.slice(1);
    const starts = [0, parts[0].length + 1, parts[0].length + parts[1].length + 2];
    const index = input.selectionStart >= starts[2] ? 2 : input.selectionStart >= starts[1] ? 1 : 0;
    const start = starts[index];
    const end = start + parts[index].length;
    if (input.selectionEnd > end) { return; }
    const selected = input.selectionStart === start && input.selectionEnd === end;
    const select = (part: number) => input.setSelectionRange(starts[part], starts[part] + parts[part].length);
    if (selected && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const next = index + (event.key === "ArrowLeft" ? -1 : 1);
        if (next >= 0 && next < parts.length) {
            event.preventDefault();
            select(next);
        }
        return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const date = parseDate(normalizeDateDraft(input.value));
        if (!date) { return; }
        event.preventDefault();
        const step = event.key === "ArrowUp" ? 1 : -1;
        const next = index === 2 ? addDays(date, step) : addMonths(date, step * (index === 0 ? 12 : 1));
        if (next.year > 9999) { return; }
        input.value = formatDate(next);
        const offset = [0, 5, 8][index];
        input.setSelectionRange(offset, offset + (index === 0 ? 4 : 2));
    } else {
        const width = index === 0 ? 4 : 2;
        const appending = parts[index].length < width && input.selectionStart === end;
        if (!/^\d$/.test(event.key) || !(selected || appending)) { return; }
        event.preventDefault();
        const draft = (selected ? "" : parts[index]) + event.key;
        const complete = draft.length === width || index === 1 && Number(draft) >= 2;
        parts[index] = complete ? draft.padStart(width, "0") : draft;
        input.value = parts.join("-");
        const cursor = start + parts[index].length;
        if (complete && index < parts.length - 1) {
            input.setSelectionRange(cursor + 1, cursor + 1 + parts[index + 1].length);
        } else {
            input.setSelectionRange(cursor, cursor);
        }
    }
    input.dispatchEvent(new Event("input", {bubbles: true}));
};

export const bindDateEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement,
    blockElement: Element,
    cellElements: HTMLElement[],
    requireExplicitChange?: boolean,
    format?: TAVDateFormat,
}) => {
    if ((options.format ?? options.cellElements?.[0]?.dataset.dateFormat) === "lunar") {
        return bindLunarDateEvent(options);
    }
    const inputElements: NodeListOf<HTMLInputElement> = options.menuElement.querySelectorAll("input");
    let dirty = false;
    let submitted = false;
    const timeEdited = [false, false];

    [inputElements[0], inputElements[1]].forEach(input => input.addEventListener("input", () => { dirty = true; }));
    const picker = bindInlineDatePicker(options.menuElement.querySelector("[data-date-inline]"),
        [inputElements[0], inputElements[1]], {
            normalizeDateDraft,
            onChange: (input, state) => {
                if (state.part === "time") { timeEdited[input === inputElements[0] ? 0 : 1] = true; }
                if (!state.valid || state.kind === "input") { return; }
                dirty = true;
            },
        });
    picker.activate(inputElements[0]);
    const validate = () => picker.validate() &&
        [inputElements[0], inputElements[1]].every(input => validateInlineDateInput(input));

    const buildDateStr = (index: number): string => {
        const inputVal = getInlineDateValue(inputElements[index]);
        if (inputVal) {
            return inputVal.length > 10 ? inputVal : inputVal + " 00:00";
        }
        return "";
    };

    const timestamp = (index: number) => {
        const value = buildDateStr(index);
        const parsed = getFullYearTime(value) || 0;
        const original = Number(inputElements[index].dataset.originalTimestamp);
        if (!parsed || !original || timeEdited[index] || !inputElements[3].checked ||
            value.substring(11) !== dayjs(original).format("HH:mm")) { return parsed; }
        // 分钟界面未编辑时间时，保留存量值中不可见的秒和毫秒。
        if (value.substring(0, 10) === dayjs(original).format("YYYY-MM-DD")) { return original; }
        return parsed + ((original % 60000) + 60000) % 60000;
    };
    const submit = () => {
        if (submitted || !validate() || !shouldSubmitDateEdit(dirty, options.requireExplicitChange === true)) {
            return;
        }
        const content1 = timestamp(0);
        const content2 = timestamp(1);
        submitted = true;
        updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
            content: content1,
            isNotEmpty: content1 !== 0,
            content2: content2,
            isNotEmpty2: content2 !== 0,
            hasEndDate: inputElements[2].checked,
            isNotTime: !inputElements[3].checked,
        }, options.cellElements, getFieldsByData(options.data));
    };

    inputElements.forEach((item, index) => {
        item.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") {
                event.stopPropagation();
            }
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
                return;
            }
            if (index < 2) { editDateSegment(item, event); }
            if (event.key === "Enter") {
                dirty = true;
                if (!validate()) { return; }
                submit();
                document.querySelector(".av__panel")?.dispatchEvent(new CustomEvent("click", {detail: "close"}));
            }
        });
    });
    inputElements[0].addEventListener("change", () => {
        dirty = true;
        inputElements[0].dataset.value = buildDateStr(0);
    });
    inputElements[1].addEventListener("change", () => {
        dirty = true;
        inputElements[1].dataset.value = buildDateStr(1);
    });
    inputElements[2].addEventListener("change", () => {
        dirty = true;
        if (inputElements[2].checked) {
            const start = inputElements[0];
            const end = inputElements[1];
            if (!getInlineDateValue(end) && validateInlineDateInput(start)) {
                const startValue = getInlineDateValue(start);
                setInlineDateValue(end, startValue);
                const useCachedTime = !inputElements[3].checked && startValue && start.dataset.value.slice(0, 10) === startValue;
                end.dataset.value = useCachedTime ? start.dataset.value : buildDateStr(1);
                end.dataset.originalTimestamp = useCachedTime ? start.dataset.originalTimestamp : String(timestamp(0));
                timeEdited[1] = !!useCachedTime && timeEdited[0];
            }
            inputElements[1].classList.remove("fn__none");
        } else {
            inputElements[1].classList.add("fn__none");
        }
        inputElements[1].closest(".date-picker__endpoint")?.classList.toggle("fn__none", !inputElements[2].checked);
        picker.update();
    });
    inputElements[3].addEventListener("change", () => {
        if (!validate()) {
            inputElements[3].checked = !inputElements[3].checked;
            return;
        }
        dirty = true;
        [inputElements[0], inputElements[1]].forEach(input => {
            const value = getInlineDateValue(input);
            if (getInlineDateType(input) === "datetime-local" || value !== input.dataset.value.substring(0, 10)) {
                input.dataset.value = value ? value.length > 10 ? value : value + " 00:00" : "";
            }
        });
        if (inputElements[3].checked) {
            inputElements[0].dataset.datePickerType = "datetime-local";
            inputElements[1].dataset.datePickerType = "datetime-local";
            inputElements[0].setAttribute("max", "9999-12-31 23:59");
            inputElements[1].setAttribute("max", "9999-12-31 23:59");
            setInlineDateValue(inputElements[0], inputElements[0].dataset.value);
            setInlineDateValue(inputElements[1], inputElements[1].dataset.value);
        } else {
            inputElements[0].dataset.datePickerType = "date";
            inputElements[1].dataset.datePickerType = "date";
            inputElements[0].setAttribute("max", "9999-12-31");
            inputElements[1].setAttribute("max", "9999-12-31");
            inputElements[0].value = inputElements[0].dataset.value.substring(0, 10);
            inputElements[1].value = inputElements[1].dataset.value.substring(0, 10);
        }
        picker.update();
    });
    return () => {
        submit();
        picker.destroy();
    };
};

const getFullYearTime = (dateStr: string) => {
    const year = dateStr.split("-")[0];
    const date = new Date(dateStr);
    if (year.startsWith("00") || year.startsWith("000") || year.length < 3) {
        date.setFullYear(parseInt(year));
        return date.getTime();
    } else {
        return date.getTime();
    }
};
