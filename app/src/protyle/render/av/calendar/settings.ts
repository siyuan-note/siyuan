import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getColNameByType} from "../col";

export const isCalendarDateColumn = (column: IAVColumn) => ["date", "created", "updated"].includes(column?.type);

export const getCalendarSettingsHTML = (view: IAVTable) => {
    const settings = view.calendar;
    const select = (key: "dateKeyID" | "colorKeyID", label: string, fields: IAVColumn[]) => `<label class="b3-menu__item">
    <span class="b3-menu__label">${label}</span>
    <select class="b3-select" data-calendar-setting="${key}" aria-label="${label}">
        <option value="">${key === "dateKeyID" ? window.siyuan.languages.calendarSelectDateField : window.siyuan.languages.calcOperatorNone}</option>
        ${fields.map(field => `<option value="${escapeAttr(field.id)}"${settings[key] === field.id ? " selected" : ""}>${escapeHtml(field.name)}</option>`).join("")}
    </select>
</label>`;
    const weekDays = Array.from({length: 7}, (_, day) => new Date(2024, 0, 7 + day).toLocaleDateString(window.siyuan.config.lang, {weekday: "long"}));
    return select("dateKeyID", window.siyuan.languages.calendarDateField, view.columns.filter(isCalendarDateColumn)) +
        select("colorKeyID", window.siyuan.languages.calendarColorField, view.columns.filter(field => field.type === "select")) +
        `<label class="b3-menu__item"><span class="b3-menu__label">${window.siyuan.languages.calendarWeekStart}</span>
    <select class="b3-select" data-calendar-setting="weekStart" aria-label="${window.siyuan.languages.calendarWeekStart}">
        ${weekDays.map((name, index) => `<option value="${index}"${settings.weekStart === index ? " selected" : ""}>${name}</option>`).join("")}
    </select>
</label>`;
};

export const bindCalendarSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
}) => {
    if (options.protyle.disabled || window.siyuan.isPublish || options.protyle.options.history?.created || options.protyle.options.history?.snapshot) {
        options.menuElement.querySelectorAll<HTMLSelectElement>("[data-calendar-setting]").forEach(select => {
            select.disabled = true;
        });
        return;
    }
    options.menuElement.querySelectorAll<HTMLSelectElement>("[data-calendar-setting]").forEach(select => {
        select.addEventListener("change", () => {
            const view = options.data.view as IAVTable;
            const previous = {...view.calendar};
            const setting = select.dataset.calendarSetting;
            const next = {...previous, [setting]: setting === "weekStart" ? Number(select.value) : select.value};
            const operation = {
                action: "setAttrViewCalendar" as const,
                avID: options.data.id,
                blockID: options.blockElement.getAttribute("data-node-id"),
                viewID: options.data.viewID,
            };
            transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
            view.calendar = next;
        });
    });
};

export const addCalendarDateField = (protyle: IProtyle, blockElement: HTMLElement, data: IAV, type: "date" | "created" | "updated") => {
    if (protyle.disabled || window.siyuan.isPublish || protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    const id = Lute.NewNodeID();
    const context = {avID: data.id, blockID: blockElement.dataset.nodeId, viewID: data.viewID};
    const settings = (data.view as IAVTable).calendar;
    transaction(protyle, [{
        ...context, action: "addAttrViewCol", id, type, name: getColNameByType(type),
    }, {
        ...context, action: "setAttrViewCalendar", data: {...settings, dateKeyID: id},
    }, {
        ...context, action: "setAttrViewColHidden", id, viewIDs: [data.viewID], data: true,
    }], [{
        ...context, action: "setAttrViewCalendar", data: settings,
    }, {
        ...context, action: "removeAttrViewCol", id,
    }]);
};
