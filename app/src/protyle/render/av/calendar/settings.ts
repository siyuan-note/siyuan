import {transaction} from "../../../wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getColNameByType} from "../col";
import {Menu} from "../../../../plugin/Menu";
import {openViewSettingMenu} from "../viewSettingMenu";

export const isCalendarDateColumn = (column: IAVColumn) => ["date", "created", "updated"].includes(column?.type);

const getCalendarSettingItems = (view: IAVTable): Array<{
    key: keyof IAVCalendarSettings;
    label: string;
    choices: Array<{value: string; label: string}>;
}> => {
    const fields = (columns: IAVColumn[]) => [{value: "", label: window.siyuan.languages.calcOperatorNone},
        ...columns.map(column => ({value: column.id, label: column.name}))];
    return [{
        key: "dateKeyID", label: window.siyuan.languages.calendarDateField,
        choices: fields(view.columns.filter(isCalendarDateColumn)),
    }, {
        key: "colorKeyID", label: window.siyuan.languages.calendarColorField,
        choices: fields(view.columns.filter(field => field.type === "select")),
    }, {
        key: "rowLimit", label: window.siyuan.languages.calendarRowLimit,
        choices: [3, 5, 10, -1].map(value => ({value: value.toString(),
            label: value === -1 ? window.siyuan.languages.all : value.toString()})),
    }, {
        key: "weekStart", label: window.siyuan.languages.calendarWeekStart,
        choices: Array.from({length: 7}, (_, day) => ({value: day.toString(),
            label: new Date(2024, 0, 7 + day).toLocaleDateString(window.siyuan.config.lang, {weekday: "long"})})),
    }];
};

export const getCalendarSettingsHTML = (view: IAVTable, asMenu = false) => getCalendarSettingItems(view).map(item => {
    const value = (item.key === "rowLimit" ? view.calendar.rowLimit || 3 : view.calendar[item.key]).toString();
    if (asMenu) {
        const selected = item.choices.find(choice => choice.value === value);
        return `<button class="b3-menu__item" data-calendar-setting="${item.key}">
    <span class="fn__flex-center">${item.label}</span><span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${escapeHtml(selected?.label || window.siyuan.languages.calcOperatorNone)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
    }
    return `<label class="av__calendar-setting"><span>${item.label}</span>
    <select class="b3-select" data-calendar-setting="${item.key}" aria-label="${item.label}">
        ${item.choices.map(choice => `<option value="${escapeAttr(choice.value)}"${choice.value === value ? " selected" : ""}>${escapeHtml(item.key === "dateKeyID" && choice.value === "" ? window.siyuan.languages.calendarSelectDateField : choice.label)}</option>`).join("")}
    </select>
</label>`;
}).join("");

export const bindCalendarSettings = (options: {
    protyle: IProtyle;
    blockElement: Element;
    data: IAV;
    menuElement: Element;
    onChange?: () => void;
}) => {
    if (options.protyle.disabled || window.siyuan.isPublish || options.protyle.options.history?.created || options.protyle.options.history?.snapshot) {
        options.menuElement.querySelectorAll<HTMLSelectElement | HTMLButtonElement>("[data-calendar-setting]").forEach(select => {
            select.disabled = true;
        });
        return;
    }
    options.menuElement.querySelectorAll<HTMLSelectElement | HTMLButtonElement>("[data-calendar-setting]").forEach(select => {
        const item = getCalendarSettingItems(options.data.view as IAVTable).find(item => item.key === select.dataset.calendarSetting);
        const update = (value: string) => {
            const view = options.data.view as IAVTable;
            const previous = {...view.calendar};
            const setting = item.key;
            if ((setting === "rowLimit" ? previous.rowLimit || 3 : previous[setting]).toString() === value) {
                return;
            }
            const next = {...previous, [setting]: setting === "weekStart" || setting === "rowLimit" ? Number(value) : value};
            const operation = {
                action: "setAttrViewCalendar" as const,
                avID: options.data.id,
                blockID: options.blockElement.getAttribute("data-node-id"),
                viewID: options.data.viewID,
            };
            transaction(options.protyle, [{...operation, data: next}], [{...operation, data: previous}]);
            view.calendar = next;
            options.onChange?.();
        };
        if (select.tagName === "BUTTON") {
            select.addEventListener("click", (event) => {
                const menu = new Menu();
                const view = options.data.view as IAVTable;
                item.choices.forEach(choice => menu.addItem({
                    iconHTML: "", label: escapeHtml(choice.label),
                    checked: (item.key === "rowLimit" ? view.calendar.rowLimit || 3 : view.calendar[item.key]).toString() === choice.value,
                    click: () => update(choice.value),
                }));
                openViewSettingMenu(menu, select);
                event.preventDefault();
                event.stopPropagation();
            });
        } else {
            select.addEventListener("change", () => update(select.value));
        }
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
