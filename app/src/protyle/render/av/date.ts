import * as dayjs from "dayjs";
import {genCellValueByElement, updateCellsValue} from "./cell";

export const getDateHTML = (cellElements: HTMLElement[]) => {
    const cellValue = genCellValueByElement("date", cellElements[0]).date;
    const isNotTime = cellValue.isNotTime;
    let value = "";
    const currentDate = new Date().getTime();
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
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value}" data-value="${dayjs(cellValue.content || currentDate).format("YYYY-MM-DD HH:mm")}" class="b3-text-field fn__size200" style="margin-top: 4px;"><br>
    <input type="${isNotTime ? "date" : "datetime-local"}" max="${isNotTime ? "9999-12-31" : "9999-12-31 23:59"}" value="${value2}" data-value="${cellValue.isNotEmpty2 ? dayjs(cellValue.content2).format("YYYY-MM-DD HH:mm") : ""}" style="margin-top: 8px;margin-bottom: 4px" class="b3-text-field fn__size200${cellValue.hasEndDate ? "" : " fn__none"}">
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
    cellElements: HTMLElement[]
}) => {
    const inputElements: NodeListOf<HTMLInputElement> = options.menuElement.querySelectorAll("input");
    inputElements.forEach(item => {
        item.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter") {
                updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
                    content: getFullYearTime(inputElements[0].dataset.value) || 0,
                    isNotEmpty: inputElements[0].value !== "",
                    content2: getFullYearTime(inputElements[1].dataset.value) || 0,
                    isNotEmpty2: inputElements[1].value !== "",
                    hasEndDate: inputElements[2].checked,
                    isNotTime: !inputElements[3].checked,
                }, options.cellElements);
                document.querySelector(".av__panel")?.dispatchEvent(new CustomEvent("click", {detail: "close"}));
            }
        });
    });
    inputElements[0].addEventListener("change", () => {
        inputElements[0].dataset.value = inputElements[0].value.length > 10 ? inputElements[0].value : inputElements[0].value + " 00:00";
    });
    inputElements[1].addEventListener("change", () => {
        inputElements[1].dataset.value = inputElements[1].value.length > 10 ? inputElements[1].value : inputElements[1].value + " 00:00";
    });
    inputElements[2].addEventListener("change", () => {
        if (inputElements[2].checked) {
            if (!inputElements[1].dataset.value) {
                const currentDate = new Date().getTime();
                inputElements[1].dataset.value = dayjs(currentDate).format("YYYY-MM-DD HH:mm");
                inputElements[1].value = dayjs(currentDate).format(inputElements[3].checked ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD");
            }
            inputElements[1].classList.remove("fn__none");
        } else {
            inputElements[1].classList.add("fn__none");
        }
    });
    inputElements[3].addEventListener("change", () => {
        inputElements[0].value = "";
        inputElements[1].value = "";
        if (inputElements[3].checked) {
            inputElements[0].setAttribute("type", "datetime-local");
            inputElements[1].setAttribute("type", "datetime-local");
            inputElements[0].setAttribute("max", "9999-12-31 23:59");
            inputElements[1].setAttribute("max", "9999-12-31 23:59");
            inputElements[0].value = inputElements[0].dataset.value;
            inputElements[1].value = inputElements[1].dataset.value;
        } else {
            inputElements[0].setAttribute("type", "date");
            inputElements[1].setAttribute("type", "date");
            inputElements[0].setAttribute("max", "9999-12-31");
            inputElements[1].setAttribute("max", "9999-12-31");
            inputElements[0].value = inputElements[0].dataset.value.substring(0, 10);
            inputElements[1].value = inputElements[1].dataset.value.substring(0, 10);
        }
    });
    return () => {
        updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
            content: getFullYearTime(inputElements[0].dataset.value) || 0,
            isNotEmpty: inputElements[0].value !== "",
            content2: getFullYearTime(inputElements[1].dataset.value) || 0,
            isNotEmpty2: inputElements[1].value !== "",
            hasEndDate: inputElements[2].checked,
            isNotTime: !inputElements[3].checked,
        }, options.cellElements);
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
