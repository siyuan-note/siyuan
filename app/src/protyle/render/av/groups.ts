import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {escapeHtml} from "../../../util/escape";
import {setPosition} from "../../../util/setPosition";
import {getFieldsByData} from "./view";
import {fetchSyncPost} from "../../../util/fetch";
import {Menu} from "../../../plugin/Menu";
import {objEquals} from "../../../util/functions";
import {Constants} from "../../../constants";

export const getPageSize = (blockElement: Element) => {
    const groupPageSize: {
        [key: string]: {
            pageSize: number
        }
    } = {};
    let unGroupPageSize: number;
    blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        const id = item.dataset.groupId;
        const pageSize = parseInt(item.dataset.pageSize);
        if (id) {
            groupPageSize[id] = {pageSize};
        } else if (!unGroupPageSize) {
            unGroupPageSize = pageSize;
        }
    });
    return {groupPageSize, unGroupPageSize};
};

export const setGroupMethod = async (options: {
    protyle: IProtyle;
    fieldId: string;
    data: IAV;
    menuElement: HTMLElement,
    blockElement: Element,
}) => {
    const blockID = options.blockElement.getAttribute("data-node-id");
    const column: IAVColumn = getFieldsByData(options.data).find(item => item.id === options.fieldId);
    const data = column ? {
        field: options.fieldId,
        method: column.type === "number" ? 1 : (["date", "updated", "created"].includes(column.type) ? 2 : 0),
        order: 0,
        range: column.type === "number" ? {
            numStart: 0,
            numEnd: 1000,
            numStep: 100,
        } : null,
        hideEmpty: true,
    } : {field: null, method: null, order: null, range: null, hideEmpty: null};
    const response = await fetchSyncPost("/api/av/setAttrViewGroup", {
        blockID,
        avID: options.blockElement.getAttribute("data-av-id"),
        group: data
    });
    options.data.view = response.data.view;
    options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view);
    bindGroupsEvent({
        protyle: options.protyle,
        menuElement: options.menuElement,
        blockElement: options.blockElement,
        data: options.data
    });
    const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
    setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth, tabRect.bottom, tabRect.height);
};

export const getGroupsMethodHTML = (columns: IAVColumn[], group: IAVGroup, viewType: TAVView) => {
    const selectHTML = '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>';
    let html = viewType === "kanban" ? "" : `<button class="b3-menu__item" data-type="setGroupMethod">
    <div class="b3-menu__label">${window.siyuan.languages.calcOperatorNone}</div>
    ${(!group || !group.field) ? selectHTML : ""}
</button>`;
    columns.forEach(item => {
        if (["rollup", "mAsset", "lineNumber"].includes(item.type)) {
            return;
        }
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
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="${(!group || !group.field) ? "go-config" : "goGroups"}">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.groupMethod}</span>
</button>
<button class="b3-menu__separator"></button>
${html}
</div>`;
};

export const getLanguageByIndex = (index: number, type: "sort" | "date") => {
    if (type === "sort") {
        switch (index) {
            case 0:
                return window.siyuan.languages.asc;
            case 1:
                return window.siyuan.languages.desc;
            case 2:
                return window.siyuan.languages.customSort;
            case 3:
                return window.siyuan.languages.sortBySelectOption;
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

export const getGroupsNumberHTML = (group: IAVGroup) => {
    return `<div class="b3-menu__items">
    <button class="b3-menu__item" data-type="nobg">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goGroups">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.numberFormatNone}</span>
    </button>
    <button class="b3-menu__separator"></button>
    <div class="b3-menu__item" data-type="nobg">
        <div class="fn__block">
            <div class="b3-menu__labels">${window.siyuan.languages.groupRange}</div>
            <div class="fn__flex">
                <input data-type="avGroupRange" class="b3-text-field fn__flex-1" value="${group?.range?.numStart || 0}">
                <span class="fn__space"></span>-<span class="fn__space"></span>
                <input class="b3-text-field fn__flex-1" value="${group?.range?.numEnd || 1000}">            
            </div>
            <div class="fn__hr"></div>
            <div class="b3-menu__labels">${window.siyuan.languages.groupStep}</div>
            <input class="b3-text-field fn__block" value="${group?.range?.numStep || 100}">
            <div class="fn__hr--small"></div>
        </div>
    </div>
</div>`;
};

export const bindGroupsNumber = (options: {
    protyle: IProtyle;
    menuElement: HTMLElement;
    blockElement: Element;
    data: IAV;
}) => {
    return async () => {
        if (!options.menuElement.querySelector('[data-type="avGroupRange"]')) {
            return;
        }
        const blockID = options.blockElement.getAttribute("data-node-id");
        const inputElements = options.menuElement.querySelectorAll("input");
        const range = {
            numStart: inputElements[0].value ? parseFloat(inputElements[0].value) : options.data.view.group.range.numStart,
            numEnd: inputElements[1].value ? parseFloat(inputElements[1].value) : options.data.view.group.range.numEnd,
            numStep: inputElements[2].value ? parseFloat(inputElements[2].value) : options.data.view.group.range.numStep
        };
        if (objEquals(options.data.view.group.range, range)) {
            return;
        }
        Object.assign(options.data.view.group.range, range);
        const response = await fetchSyncPost("/api/av/setAttrViewGroup", {
            blockID,
            avID: options.blockElement.getAttribute("data-av-id"),
            group: options.data.view.group
        });
        options.data.view = response.data.view;
    };
};

export const getGroupsHTML = (columns: IAVColumn[], view: IAVView) => {
    let html = "";
    let column: IAVColumn;
    if (view.group && view.group.field) {
        let groupHTML = "";
        column = columns.find(item => item.id === view.group.field);
        if (view.groups?.length > 0) {
            const disabledDrag = ["created", "date", "created", "updated"].includes(column.type);
            let showCount = 0;
            view.groups.forEach(item => {
                if (item.groupHidden === 0) {
                    showCount++;
                }
                let titleHTML = `<div class="b3-menu__label fn__flex-1 fn__ellipsis">${item.name || ""}</div>`;
                if (item.groupValue?.mSelect?.length > 0) {
                    titleHTML = `<div class="fn__flex-1">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.groupValue.mSelect[0].color});color:var(--b3-font-color${item.groupValue.mSelect[0].color})">
            <span class="fn__ellipsis">${escapeHtml(item.groupValue.mSelect[0].content)}</span>
        </span>
    </div>`;
                } else if (item.groupValue?.type == "checkbox") {
                    titleHTML = `<div class="b3-menu__label fn__flex">
<svg class="b3-menu__icon"><use xlink:href="#icon${item.groupValue.checkbox.checked ? "Check" : "Uncheck"}"></use></svg> ${column.name || ""}
</div>`;
                }
                groupHTML += `<button class="b3-menu__item${item.groupHidden === 0 ? "" : " b3-menu__item--hidden"}" draggable="${disabledDrag ? "false" : "true"}" data-id="${item.id}">
    ${disabledDrag ? "" : '<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>'}
    ${titleHTML}
    <svg class="b3-menu__action b3-menu__action--show" data-type="hideGroup" data-id="${item.id}"><use xlink:href="#iconEye${item.groupHidden === 0 ? "" : "off"}"></use></svg>
</button>`;
            });
            groupHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label"></span>
    <span class="block__icon" data-type="hideGroups">
        ${window.siyuan.languages[showCount === 0 ? "showAll" : "hideAll"]}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEye${showCount === 0 ? "" : "off"}"></use></svg>
    </span>
</button>` + groupHTML;
        }
        html = `<button class="b3-menu__item${["date", "updated", "created"].includes(column.type) ? "" : " fn__none"}" data-type="goGroupsDate">
    <span class="b3-menu__label">${window.siyuan.languages.date}</span>
    <span class="b3-menu__accelerator">${getLanguageByIndex(view.group.method, "date")}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item${column.type === "number" ? "" : " fn__none"}" data-type="getGroupsNumber">
    <span class="b3-menu__label">${window.siyuan.languages.numberFormatNone}</span>
    <span class="b3-menu__accelerator">${(view.group.range && typeof view.group.range.numStart === "number") ? `${view.group.range.numStart} - ${view.group.range.numEnd}` : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item${["checkbox", "rollup", "mAsset"].includes(column.type) ? " fn__none" : ""}" data-type="goGroupsSort">
    <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
    <span class="b3-menu__accelerator">${getLanguageByIndex(view.group.order, "sort")}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.hideEmptyGroup}</span>
    <span class="fn__space fn__flex-1"></span>
    <input type="checkbox" class="b3-switch b3-switch--menu"${view.group.hideEmpty ? " checked" : ""}>
</label>
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

export const bindGroupsEvent = (options: {
    protyle: IProtyle;
    menuElement: HTMLElement;
    blockElement: Element;
    data: IAV;
}) => {
    const checkElement = options.menuElement.querySelector("input");
    if (!checkElement) {
        return;
    }
    const blockID = options.blockElement.getAttribute("data-node-id");
    checkElement.addEventListener("change", async () => {
        options.data.view.group.hideEmpty = checkElement.checked;
        const response = await fetchSyncPost("/api/av/setAttrViewGroup", {
            blockID,
            avID: options.blockElement.getAttribute("data-av-id"),
            group: options.data.view.group
        });
        options.data.view = response.data.view;
        options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view);
        bindGroupsEvent({
            protyle: options.protyle,
            menuElement: options.menuElement,
            blockElement: options.blockElement,
            data: options.data
        });
        const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
        setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth, tabRect.bottom, tabRect.height);
    });
};

export const goGroupsDate = (options: {
    protyle: IProtyle;
    target: Element;
    menuElement: HTMLElement;
    data: IAV;
    blockElement: Element;
}) => {
    const menu = new Menu(Constants.MENU_AV_GROUP_DATE);
    if (menu.isOpen) {
        return;
    }
    const blockID = options.blockElement.getAttribute("data-node-id");
    [2, 3, 4, 5, 6].forEach((item) => {
        const label = getLanguageByIndex(item, "date");
        menu.addItem({
            iconHTML: "",
            checked: options.data.view.group.method === item,
            label,
            async click() {
                options.data.view.group.method = item;
                options.target.querySelector(".b3-menu__accelerator").textContent = label;
                const response = await fetchSyncPost("/api/av/setAttrViewGroup", {
                    blockID,
                    avID: options.blockElement.getAttribute("data-av-id"),
                    group: options.data.view.group
                });
                options.data.view = response.data.view;
                options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view);
                bindGroupsEvent({
                    protyle: options.protyle,
                    menuElement: options.menuElement,
                    blockElement: options.blockElement,
                    data: options.data
                });
                const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth, tabRect.bottom, tabRect.height);
            }
        });
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        isLeft: true,
        x: rect.right,
        y: rect.bottom
    });
};

export const goGroupsSort = (options: {
    protyle: IProtyle;
    target: Element;
    data: IAV;
    menuElement: HTMLElement;
    blockElement: Element;
}) => {
    const menu = new Menu(Constants.MENU_AV_GROUP_SORT);
    if (menu.isOpen) {
        return;
    }
    const blockID = options.blockElement.getAttribute("data-node-id");
    const column = getFieldsByData(options.data).find(item => item.id === options.data.view.group.field);
    (["created", "date", "created", "updated"].includes(column.type) ? [0, 1] : (
        ["mSelect", "select"].includes(column.type) ? [3, 2, 0, 1] : [2, 0, 1]
    )).forEach((item) => {
        const label = getLanguageByIndex(item, "sort");
        menu.addItem({
            iconHTML: "",
            checked: options.data.view.group.order === item,
            label,
            async click() {
                options.target.querySelector(".b3-menu__accelerator").textContent = label;
                options.data.view.group.order = item;
                const response = await fetchSyncPost("/api/av/setAttrViewGroup", {
                    blockID,
                    avID: options.blockElement.getAttribute("data-av-id"),
                    group: options.data.view.group
                });
                options.data.view = response.data.view;
                options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view);
                bindGroupsEvent({
                    protyle: options.protyle,
                    menuElement: options.menuElement,
                    blockElement: options.blockElement,
                    data: options.data
                });
                const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
                setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth, tabRect.bottom, tabRect.height);
            }
        });
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        isLeft: true,
        x: rect.right,
        y: rect.bottom
    });
};
