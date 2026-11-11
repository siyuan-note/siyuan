import dayjs from "dayjs";
import {genCellValueByElement, updateCellsValue} from "./cell";
import {getFieldsByData} from "./view";
import {shouldSubmitDateEdit} from "./dateSubmit";
import {bindLunarDateEvent, getLunarDateHTML} from "./lunarDate";
import {bindInlineDatePicker, getInlineDateType, validateInlineDateInput} from "../../../datePicker/inline";

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
    if (cellValue.isNotEmpty2) {
        value2 = dayjs(cellValue.content2).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
        const year = value2.split("-")[0];
        if (year.length !== 4) {
            value2 = new Array(4 - year.length).fill(0).join("") + value2;
        }
    } else if (cellValue.hasEndDate) {
        value2 = dayjs(currentDate).format(isNotTime ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");
    }
    return `<div class="b3-menu__items">
<div>
    <label class="date-picker__endpoint"><span class="ft__smaller">${window.siyuan.languages.startDate}</span>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value}" data-value="${dayjs(cellValue.content || currentDate).format("YYYY-MM-DD HH:mm")}" class="b3-text-field fn__size200" style="margin-top: 4px;"></label>
    <label class="date-picker__endpoint${cellValue.hasEndDate ? "" : " fn__none"}"><span class="ft__smaller">${window.siyuan.languages.endDate}</span>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value2}" data-value="${cellValue.isNotEmpty2 ? dayjs(cellValue.content2).format("YYYY-MM-DD HH:mm") : ""}" style="margin-top: 8px;margin-bottom: 4px" class="b3-text-field fn__size200${cellValue.hasEndDate ? "" : " fn__none"}"></label>
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

    [inputElements[0], inputElements[1]].forEach(input => input.addEventListener("input", () => { dirty = true; }));
    const picker = bindInlineDatePicker(options.menuElement.querySelector("[data-date-inline]"),
        [inputElements[0], inputElements[1]], {onChange: (_input, state) => {
            if (!state.valid || state.kind === "input") { return; }
            dirty = true;
        }});
    picker.activate(inputElements[0]);
    const validate = () => picker.validate() &&
        [inputElements[0], inputElements[1]].every(input => validateInlineDateInput(input));

    const buildDateStr = (index: number): string => {
        const inputVal = inputElements[index].value;
        if (inputVal) {
            return inputVal.length > 10 ? inputVal : inputVal + " 00:00";
        }
        return "";
    };

    const submit = () => {
        if (submitted || !validate() || !shouldSubmitDateEdit(dirty, options.requireExplicitChange === true)) {
            return;
        }
        const dateStr1 = buildDateStr(0);
        const dateStr2 = buildDateStr(1);
        const content1 = getFullYearTime(dateStr1) || 0;
        const content2 = getFullYearTime(dateStr2) || 0;
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

    inputElements.forEach(item => {
        item.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") {
                event.stopPropagation();
            }
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
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
        inputElements[0].dataset.value = inputElements[0].value.length > 10 ? inputElements[0].value : inputElements[0].value + " 00:00";
    });
    inputElements[1].addEventListener("change", () => {
        dirty = true;
        inputElements[1].dataset.value = inputElements[1].value.length > 10 ? inputElements[1].value : inputElements[1].value + " 00:00";
    });
    inputElements[2].addEventListener("change", () => {
        dirty = true;
        if (inputElements[2].checked) {
            if (!inputElements[1].dataset.value) {
                const currentDate = Date.now();
                inputElements[1].dataset.value = dayjs(currentDate).format("YYYY-MM-DD HH:mm");
                inputElements[1].value = dayjs(currentDate).format(inputElements[3].checked ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD");
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
            if (getInlineDateType(input) === "datetime-local" || input.value !== input.dataset.value.substring(0, 10)) {
                input.dataset.value = input.value ? input.value.length > 10 ? input.value : input.value + " 00:00" : "";
            }
        });
        if (inputElements[3].checked) {
            inputElements[0].dataset.datePickerType = "datetime-local";
            inputElements[1].dataset.datePickerType = "datetime-local";
            inputElements[0].setAttribute("max", "9999-12-31 23:59");
            inputElements[1].setAttribute("max", "9999-12-31 23:59");
            inputElements[0].value = inputElements[0].dataset.value.replace(" ", "T");
            inputElements[1].value = inputElements[1].dataset.value.replace(" ", "T");
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
