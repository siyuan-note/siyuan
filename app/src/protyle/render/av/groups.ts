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
    transaction(options.protyle, [{
        action: "setAttrViewGroup",
        avID: options.data.id,
        blockID,
        data: {
            field: options.fieldId,
            method: null,
            order: null,
            range: null
        }
    }], [{
        action: "setAttrViewGroup",
        avID: options.data.id,
        blockID,
        data: {
            field: options.data.view.group?.field || "",
            method: null,
            order: null,
            range: null
        }
    }]);
    if (!options.data.view.group) {
        options.data.view.group = {
            field: options.fieldId
        };
    } else {
        options.data.view.group.field = options.fieldId;
    }
    options.menuElement.innerHTML = getGroupsHTML(getFieldsByData(options.data), options.data.view.group);
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

export const getGroupsHTML = (columns: IAVColumn[], group: IAVGroup) => {
    let html = "";
    if (group) {
        html = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="removeGroups">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
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
    <span class="b3-menu__accelerator">${group ? columns.filter(item => item.id === group.field)[0].name : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
${html}
</div>`;
};

export const bindGroupsEvent = () => {

};
