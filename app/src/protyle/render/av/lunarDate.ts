import {escapeAttr, escapeHtml} from "../../../util/escape";
import {showMessage} from "../../../dialog/message";
import {genCellValueByElement, updateCellsValue} from "./cell";
import {getFieldsByData} from "./view";
import {shouldSubmitDateEdit} from "./dateSubmit";
import {getLunarDayLabel, getLunarMonthLabel, getLunarMonths, lunarFirstYear, lunarLastYear, lunarToSolar, solarToLunar} from "./lunarCalendar";
import {formatDateDisplay} from "./dateFormat";

const option = (value: number, label: string, selected?: number) =>
    `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;

const getEndpointHTML = (content: number, isNotTime: boolean, hidden: boolean) => {
    const lunar = solarToLunar(content);
    const solar = new Date(content);
    const lang = window.siyuan.languages;
    const month = lunar && getLunarMonths(lunar.year).find(month => month[1] === lunar.month);
    return `<div class="av__lunar-date${hidden ? " fn__none" : ""}" data-lunar-endpoint>
<div class="av__lunar-date-controls">
<select class="b3-select" data-lunar-part="year" aria-label="${escapeAttr(lang.year)}"><option value="">${escapeHtml(lang.year)}</option>${Array.from({length: lunarLastYear - lunarFirstYear + 1}, (_, index) => option(index + lunarFirstYear, String(index + lunarFirstYear), lunar?.year)).join("")}</select>
<select class="b3-select" data-lunar-part="month" aria-label="${escapeAttr(lang.month)}"><option value="">${escapeHtml(lang.month)}</option>${lunar ? getLunarMonths(lunar.year).map(month => option(month[1], getLunarMonthLabel(month[1]), lunar.month)).join("") : ""}</select>
<select class="b3-select" data-lunar-part="day" aria-label="${escapeAttr(lang.day)}"><option value="">${escapeHtml(lang.day)}</option>${month ? Array.from({length: month[3]}, (_, day) => option(day + 1, getLunarDayLabel(day + 1), lunar.day)).join("") : ""}</select>
</div>
<input type="time" class="b3-text-field${isNotTime ? " fn__none" : ""}" data-lunar-time value="${String(solar.getHours()).padStart(2, "0")}:${String(solar.getMinutes()).padStart(2, "0")}" aria-label="${escapeAttr(lang.includeTime)}">
<div class="ft__smaller ft__on-surface" data-lunar-preview>${escapeHtml(lunar ? lang._attrView.solarCalendar + " " + formatDateDisplay(content, "full", isNotTime) : lang._attrView.lunarRange)}</div>
<div class="ft__error ft__smaller fn__none" data-lunar-error role="alert">${escapeHtml(lang._attrView.lunarInvalid)}</div>
</div>`;
};

export const getLunarDateHTML = (value: IAVCellDateValue) => {
    const now = Date.now();
    const lang = window.siyuan.languages;
    return `<div class="b3-menu__items">
<div class="av__lunar-editor">
<div class="ft__smaller ft__on-surface">${lang._attrView.lunarCalendar}</div>
${getEndpointHTML(value.isNotEmpty ? value.content : now, value.isNotTime, false)}
${getEndpointHTML(value.isNotEmpty2 ? value.content2 : now, value.isNotTime, !value.hasEndDate)}
<button class="b3-menu__separator"></button>
<label class="b3-menu__item"><span class="fn__flex-center">${lang.endDate}</span><span class="fn__space fn__flex-1"></span><input data-lunar-end type="checkbox" class="b3-switch b3-switch--menu"${value.hasEndDate ? " checked" : ""}></label>
<label class="b3-menu__item"><span class="fn__flex-center">${lang.includeTime}</span><span class="fn__space fn__flex-1"></span><input data-lunar-include-time type="checkbox" class="b3-switch b3-switch--menu"${value.isNotTime ? "" : " checked"}></label>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="clearDate"><svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg><span class="b3-menu__label">${lang.clear}</span></button>
</div></div>`;
};

export const bindLunarDateEditor = (options: {
    value: IAVCellDateValue;
    menuElement: HTMLElement;
    update: (value: IAVCellDateValue) => void;
    close: () => void;
    requireExplicitChange?: boolean;
}) => {
    const original = options.value;
    const endpoints = Array.from(options.menuElement.querySelectorAll<HTMLElement>("[data-lunar-endpoint]"));
    const hasEnd = options.menuElement.querySelector<HTMLInputElement>("[data-lunar-end]");
    const includeTime = options.menuElement.querySelector<HTMLInputElement>("[data-lunar-include-time]");
    const edited = [false, false];
    let dirty = false;
    const read = (element: HTMLElement) => {
        const parts = element.querySelectorAll<HTMLSelectElement>("select");
        const time = element.querySelector<HTMLInputElement>("[data-lunar-time]").value.split(":");
        return lunarToSolar({year: Number(parts[0].value), month: Number(parts[1].value), day: Number(parts[2].value)},
            includeTime.checked ? Number(time[0]) : 0, includeTime.checked ? Number(time[1]) : 0);
    };
    const refresh = (element: HTMLElement) => {
        const content = read(element);
        element.querySelector("[data-lunar-error]").classList.toggle("fn__none", content !== undefined);
        element.querySelector("[data-lunar-preview]").textContent = content === undefined ? "" :
            window.siyuan.languages._attrView.solarCalendar + " " + formatDateDisplay(content, "full", !includeTime.checked);
        return content;
    };
    endpoints.forEach((element, index) => {
        element.addEventListener("change", event => {
            dirty = true;
            edited[index] = true;
            const target = event.target as HTMLElement;
            const parts = element.querySelectorAll<HTMLSelectElement>("select");
            if (target.dataset.lunarPart === "year") {
                const oldMonth = Number(parts[1].value);
                parts[1].innerHTML = `<option value="">${escapeHtml(window.siyuan.languages.month)}</option>` +
                    getLunarMonths(Number(parts[0].value)).map(month => option(month[1], getLunarMonthLabel(month[1]), oldMonth)).join("");
            }
            if (target.dataset.lunarPart === "year" || target.dataset.lunarPart === "month") {
                const oldDay = Number(parts[2].value);
                const month = getLunarMonths(Number(parts[0].value)).find(month => month[1] === Number(parts[1].value));
                parts[2].innerHTML = `<option value="">${escapeHtml(window.siyuan.languages.day)}</option>` +
                    (month ? Array.from({length: month[3]}, (_, day) => option(day + 1, getLunarDayLabel(day + 1), oldDay)).join("") : "");
            }
            refresh(element);
        });
    });
    hasEnd.addEventListener("change", () => {
        dirty = true;
        endpoints[1].classList.toggle("fn__none", !hasEnd.checked);
    });
    includeTime.addEventListener("change", () => {
        dirty = true;
        endpoints.forEach(element => {
            element.querySelector("[data-lunar-time]").classList.toggle("fn__none", !includeTime.checked);
            refresh(element);
        });
    });
    let submitted = false;
    const submit = () => {
        if (submitted || !shouldSubmitDateEdit(dirty, options.requireExplicitChange === true)) {
            return true;
        }
        // 未修改的端点保留原始时间戳，包括秒和毫秒以及对照表范围外的旧日期。
        const content = !edited[0] && original.isNotEmpty ? original.content : refresh(endpoints[0]);
        const content2 = !edited[1] && original.isNotEmpty2 ? original.content2 :
            hasEnd.checked || edited[1] ? refresh(endpoints[1]) : undefined;
        if (content === undefined || hasEnd.checked && content2 === undefined) {
            showMessage(window.siyuan.languages._attrView.lunarInvalid);
            return false;
        }
        if (!dirty && original.isNotEmpty) {
            return true;
        }
        submitted = true;
        options.update({
            content, isNotEmpty: true, content2: content2 || 0, isNotEmpty2: content2 !== undefined,
            hasEndDate: hasEnd.checked, isNotTime: !includeTime.checked,
        });
        return true;
    };
    options.menuElement.querySelectorAll("input, select").forEach(control => control.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Escape") {
            event.stopPropagation();
        }
        if (event.key === "Enter" && !event.isComposing && !(control instanceof HTMLSelectElement)) {
            dirty = true;
            if (submit()) {
                options.close();
            }
        }
    }));
    options.menuElement.querySelector('[data-type="clearDate"]').addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        submitted = true;
        options.update({content: 0, content2: 0, isNotEmpty: false, isNotEmpty2: false, hasEndDate: false, isNotTime: original.isNotTime});
        options.close();
    });
    return () => { submit(); };
};

export const bindLunarDateEvent = (options: {
    protyle: IProtyle;
    data: IAV;
    menuElement: HTMLElement;
    blockElement: Element;
    cellElements: HTMLElement[];
    requireExplicitChange?: boolean;
}) => bindLunarDateEditor({
    value: genCellValueByElement("date", options.cellElements[0]).date,
    menuElement: options.menuElement,
    update: value => updateCellsValue(options.protyle, options.blockElement as HTMLElement, value,
        options.cellElements, getFieldsByData(options.data)),
    close: () => document.querySelector(".av__panel")?.dispatchEvent(new CustomEvent("click", {detail: "close"})),
    requireExplicitChange: options.requireExplicitChange,
});
