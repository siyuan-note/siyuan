import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {setPosition} from "../../../util/setPosition";
import {getFieldsByData} from "./view";

export const setGroupMethod = (options: {
    protyle: IProtyle;
    fieldId: string;
    data: IAV;
    menuElement: HTMLElement,
    blockElement: Element,
}) => {
    const blockID = options.blockElement.getAttribute("data-block-id");
    const column: IAVColumn = getFieldsByData(options.data).find(item => item.id === options.fieldId);
    const data = {
        field: options.fieldId,
        method: column.type === "number" ? 1 : (["date", "updated", "created"].includes(column.type) ? 2 : 0),
        order: 0,
        range: column.type === "number" ? {
            numStart: 0,
            numEnd: 1000,
            numStep: 100,
        } : null
    };
    transaction(options.protyle, [{
        action: "setAttrViewGroup",
        avID: options.data.id,
        blockID,
        data
    }], [{
        action: "setAttrViewGroup",
        avID: options.data.id,
        blockID,
        data: {
            field: options.data.view.group?.field || "",
            method: options.data.view.group?.method || "",
            order: options.data.view.group?.order || "",
            range: options.data.view.group?.range || ""
        }
    }]);
    options.data.view.group = data;
    options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view);
    // bindGroupsEvent(options.protyle, options.menuElement, options.data, blockID);
    const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
    setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth, tabRect.bottom, tabRect.height);
};

export const getGroupsMethodHTML = (columns: IAVColumn[], group: IAVGroup) => {
    const selectHTML = '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>';
    let html = `<button class="b3-menu__item" data-type="setGroupMethod">
    <div class="b3-menu__label">${window.siyuan.languages.calcOperatorNone}</div>
    ${group ? "" : selectHTML}
</button>`;
    columns.forEach(item => {
        html += `<button class="b3-menu__item" data-id="${item.id}" data-type="setGroupMethod">
    <div class="b3-menu__label fn__flex">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${escapeHtml(item.name) || "&nbsp;"}
    </div>
    ${group?.field === item.id ? selectHTML : ""}
</button>`;
    });
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goGroups">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.groupMethod}</span>
</button>
<button class="b3-menu__separator"></button>
${html}
</div>`;
};

const getLanguageByIndex = (index: number, type: "sort" | "date") => {
    if (type === "sort") {
        switch (index) {
            case 0:
                return window.siyuan.languages.asc;
            case 1:
                return window.siyuan.languages.desc;
            case 2:
                return window.siyuan.languages.customSort;
            default:
                return "";
        }
    } else if (type === "date") {
        switch (index) {
            case 2:
                return window.siyuan.languages.groupMethodDateRelative;
            case 3:
                return window.siyuan.languages.groupMethodDateDay;
            case 4:
                return window.siyuan.languages.groupMethodDateWeek;
            case 5:
                return window.siyuan.languages.groupMethodDateMonth;
            case 6:
                return window.siyuan.languages.groupMethodDateYear;
            default:
                return "";
        }
    }
};

export const getGroupsHTML = (columns: IAVColumn[], view: IAVView) => {
    let html = "";
    let column: IAVColumn;
    if (view.group && view.group.field) {
        let groupHTML = "";
        if (view.groups.length > 0) {
            groupHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.groups}</span>
</button>`;
            view.groups.forEach(item => {
                groupHTML += `<button class="b3-menu__item" draggable="true">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex">${item.name || ""}</div>
    <svg class="b3-menu__action"><use xlink:href="#iconEye${item.groupHidden ? "off" : ""}"></use></svg>
</button>`;
            });
        }
        column = columns.find(item => item.id === view.group.field);
        html = `<button class="b3-menu__item${["date", "updated", "created"].includes(column.type) ? "" : " fn__none"}" data-type="goGroupsDate">
    <span class="b3-menu__label">${window.siyuan.languages.date}</span>
    <span class="b3-menu__accelerator">${getLanguageByIndex(view.group.method, "date")}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item${column.type === "number" ? "" : " fn__none"}" data-type="goGroupsNumber">
    <span class="b3-menu__label">${window.siyuan.languages.numberFormatNone}</span>
    <span class="b3-menu__accelerator">${(view.group.range && typeof view.group.range.numStart === "number") ? `${view.group.range.numStart} - ${view.group.range.numEnd}` : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goGroupsSort">
    <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
    <span class="b3-menu__accelerator">${getLanguageByIndex(view.group.order, "sort")}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.hideEmptyGroup}</span>
    <span class="fn__space fn__flex-1"></span>
    <input type="checkbox" class="b3-switch b3-switch--menu">
</button>
${groupHTML}
<button class="b3-menu__separator"></button>
<button class="b3-menu__item b3-menu__item--warning" data-type="removeGroups">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.removeGroup}</span>
</button>`;
    }
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.group}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="goGroupsMethod">
    <span class="b3-menu__label">${window.siyuan.languages.groupMethod}</span>
    <span class="b3-menu__accelerator">${column ? column.name : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
${html}
</div>`;
};

export const bindGroupsEvent = () => {

};
