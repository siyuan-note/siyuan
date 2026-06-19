import * as dayjs from "dayjs";
import {genCellValueByElement, updateCellsValue} from "./cell";

export const getDateHTML = (cellElements: HTMLElement[]) => {
    const cellValue = genCellValueByElement("date", cellElements[0]).date;
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

    // <input type="date"> 对非法日期（如 6-34）会清空 input.value，导致 year/month 信息也随之丢失。
    // 这里在 focus 时记录编辑前的原值，keydown 时累积按键序列，提交时用于兜底重建 year/month。
    const lastNonEmptyValue: string[] = [inputElements[0].value, inputElements[1].value];
    const typedDigits: string[] = ["", ""];
    const bindTracking = (input: HTMLInputElement, index: number) => {
        input.addEventListener("focus", () => {
            lastNonEmptyValue[index] = input.value;
            typedDigits[index] = "";
        });
        input.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }
            if (/^\d$/.test(event.key)) {
                typedDigits[index] += event.key;
            }
        });
        input.addEventListener("input", () => {
            // 仅当 input.value 是合法完整日期时才更新原值记录。
            // 这样改 month/year（合法值）后能同步，而删除过程中的部分残值（如 "2024-08-"）不会污染。
            if (input.value && input.value.replace(/\D/g, "").length >= 8) {
                lastNonEmptyValue[index] = input.value;
            }
        });
    };
    bindTracking(inputElements[0], 0);
    bindTracking(inputElements[1], 1);

    // 计算指定年月的天数（如 2024年2月=29，6月=30，12月=31）
    const getMaxDay = (year: number, month: number) => new Date(year, month, 0).getDate();

    // 用数字参数构造时间戳，Date 构造函数会自动进位（如 new Date(2024, 5, 34) → 2024-07-04）
    const carryOverflow = (year: number, month: number, day: number): number => {
        return new Date(year, month - 1, day).getTime();
    };

    // 构造用于保存的日期字符串。
    // 浏览器对非法日有两种处理：截断（如 12月34→12-31）或清空（如 6月34→""）。
    // 无论哪种，只要 typedDigits 末尾 2 位 > 当月最大天数，说明用户输入了非法 day，应进位而非截断。
    const buildDateStr = (index: number): {dateStr: string, overflowTs: number} => {
        const digits = typedDigits[index];
        // 提取 year/month：优先用 lastNonEmptyValue（已随合法编辑更新），其次用 input.value，最后用按键序列前 6 位
        let year = 0, month = 0;
        const lastVal = lastNonEmptyValue[index];
        const val = inputElements[index].value || lastVal;
        if (val) {
            const valDigits = val.replace(/\D/g, "");
            if (valDigits.length >= 6) {
                year = parseInt(valDigits.substring(0, 4), 10);
                month = parseInt(valDigits.substring(4, 6), 10);
            }
        }
        if ((month < 1 || month > 12) && digits.length >= 6) {
            year = parseInt(digits.substring(0, 4), 10);
            month = parseInt(digits.substring(4, 6), 10);
        }

        // 检测是否有非法 day 输入（typedDigits 末尾 2 位 > 当月最大天数）
        if (month >= 1 && month <= 12 && digits.length >= 2) {
            const inputDay = parseInt(digits.slice(-2), 10);
            const maxDay = getMaxDay(year, month);
            if (inputDay > maxDay) {
                // 用户输入了非法 day（被浏览器截断或清空），用进位还原真实意图
                const ts = carryOverflow(year, month, inputDay);
                if (!isNaN(ts)) {
                    return {dateStr: "", overflowTs: ts};
                }
            }
        }

        // 无非法 day：正常用浏览器值
        if (val) {
            return {dateStr: val.length > 10 ? val : val + " 00:00", overflowTs: 0};
        }
        // 兜底：从按键序列构造（完整输入但无原值的场景）
        if (month >= 1 && month <= 12) {
            let day = getMaxDay(year, month);
            if (digits.length >= 8) {
                day = parseInt(digits.slice(-2), 10);
            }
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            return {dateStr, overflowTs: 0};
        }
        return {dateStr: "", overflowTs: 0};
    };

    const submit = () => {
        const result1 = buildDateStr(0);
        const result2 = buildDateStr(1);
        // 优先用进位后的时间戳（overflowTs），否则用 getFullYearTime 解析 dateStr
        const content1 = result1.overflowTs || getFullYearTime(result1.dateStr) || 0;
        const content2 = result2.overflowTs || getFullYearTime(result2.dateStr) || 0;
        updateCellsValue(options.protyle, options.blockElement as HTMLElement, {
            content: content1,
            isNotEmpty: content1 !== 0,
            content2: content2,
            isNotEmpty2: content2 !== 0,
            hasEndDate: inputElements[2].checked,
            isNotTime: !inputElements[3].checked,
        }, options.cellElements);
    };

    inputElements.forEach(item => {
        item.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter") {
                submit();
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
                const currentDate = Date.now();
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
        submit();
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
