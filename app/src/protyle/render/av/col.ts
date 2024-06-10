import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {getDefaultOperatorByType, setFilter} from "./filter";
import {genCellValue} from "./cell";
import {openMenuPanel} from "./openMenuPanel";
import {getLabelByNumberFormat} from "./number";
import {removeAttrViewColAnimation, updateAttrViewCellAnimation} from "./action";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {toggleUpdateRelationBtn} from "./relation";
import {bindRollupData, getRollupHTML} from "./rollup";
import {Constants} from "../../../constants";
import * as dayjs from "dayjs";
import {setPosition} from "../../../util/setPosition";
import {duplicateNameAddOne} from "../../../util/functions";

export const duplicateCol = (options: {
    protyle: IProtyle,
    colId: string,
    viewID: string,
    blockElement: Element,
    data: IAV,
}) => {
    let newColData: IAVColumn;
    options.data.view.columns.find((item: IAVColumn, index) => {
        if (item.id === options.colId) {
            newColData = JSON.parse(JSON.stringify(item));
            options.data.view.columns.splice(index + 1, 0, newColData);
            return true;
        }
    });
    newColData.name = duplicateNameAddOne(newColData.name);
    newColData.id = Lute.NewNodeID();
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    const blockId = options.blockElement.getAttribute("data-node-id");
    transaction(options.protyle, [{
        action: "duplicateAttrViewKey",
        keyID:newColData.id,
        nextID:options.colId,
        avID: options.data.id,
    }, {
        action: "doUpdateUpdated",
        id: blockId,
        data: newUpdated,
    }], [{
        action: "removeAttrViewCol",
        id: newColData.id,
        avID: options.data.id,
    }, {
        action: "doUpdateUpdated",
        id: blockId,
        data: options.blockElement.getAttribute("updated")
    }]);
    addAttrViewColAnimation({
        blockElement: options.blockElement,
        protyle: options.protyle,
        type: newColData.type,
        name: newColData.name,
        icon: newColData.icon,
        previousID: options.colId,
        data: options.data,
        id: newColData.id,
    });
    options.blockElement.setAttribute("updated", newUpdated);
};

export const getEditHTML = (options: {
    protyle: IProtyle,
    colId: string,
    data: IAV,
    isCustomAttr: boolean
}) => {
    let colData: IAVColumn;
    options.data.view.columns.find((item) => {
        if (item.id === options.colId) {
            colData = item;
            return true;
        }
    });
    let html = `<button class="b3-menu__item" data-type="nobg" data-col-id="${options.colId}">
    <span class="block__icon${options.isCustomAttr ? " fn__none" : ""}" style="padding: 8px;margin-left: -4px;" data-type="go-properties">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.edit}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span style="padding: 5px;margin-right: 8px;width: 14px;font-size: 14px;" class="block__icon block__icon--show" data-col-type="${colData.type}" data-icon="${colData.icon}" data-type="update-icon">${colData.icon ? unicode2Emoji(colData.icon) : `<svg><use xlink:href="#${getColIconByType(colData.type)}"></use></svg>`}</span>
    <span class="b3-menu__label" style="padding: 4px;display: flex;"><input data-type="name" class="b3-text-field fn__block" type="text" value="${colData.name}"></span>
</button>
<button class="b3-menu__item" data-type="goUpdateColType" ${colData.type === "block" ? "disabled" : ""}>
    <span class="b3-menu__label">${window.siyuan.languages.type}</span>
    <span class="fn__space"></span>
    <svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(colData.type)}"></use></svg>
    <span class="b3-menu__accelerator" style="margin-left: 0">${getColNameByType(colData.type)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
    if (["mSelect", "select"].includes(colData.type)) {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label" style="padding: 4px;display: flex"><input data-type="addOption" class="b3-text-field fn__block fn__size200" type="text" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.addAttr}"></span>
</button>`;
        if (!colData.options) {
            colData.options = [];
        }
        colData.options.forEach(item => {
            html += `<button class="b3-menu__item${html ? "" : " b3-menu__item--current"}" draggable="true" data-name="${item.name}" data-color="${item.color}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${item.name}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="setColOption"><use xlink:href="#iconEdit"></use></svg>
</button>`;
        });
    } else if (colData.type === "number") {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="numberFormat" data-format="${colData.numberFormat}">
    <svg class="b3-menu__icon"><use xlink:href="#iconFormat"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.format}</span>
    <span class="b3-menu__accelerator">${getLabelByNumberFormat(colData.numberFormat)}</span>
</button>`;
    } else if (colData.type === "template") {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <textarea spellcheck="false" rows="${Math.min(colData.template.split("\n").length, 8)}" placeholder="${window.siyuan.languages.template}" data-type="updateTemplate" style="margin: 4px 0" rows="1" class="fn__block b3-text-field">${colData.template}</textarea>
</button>`;
    } else if (colData.type === "relation") {
        const isSelf = colData.relation?.avID === options.data.id;
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="goSearchAV" data-av-id="${colData.relation?.avID || ""}" data-old-value='${JSON.stringify(colData.relation || {})}'>
    <span class="b3-menu__label">${window.siyuan.languages.relatedTo}</span>
    <span class="b3-menu__accelerator">${isSelf ? window.siyuan.languages.thisDatabase : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.backRelation}</span>
    <svg class="b3-menu__icon b3-menu__icon--small fn__none"><use xlink:href="#iconHelp"></use></svg>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="backRelation" type="checkbox" class="b3-switch b3-switch--menu" ${colData.relation?.isTwoWay ? "checked" : ""}>
</label>
<div class="b3-menu__item fn__flex-column fn__none" data-type="nobg">
    <input data-old-value="" data-type="colName" style="margin: 8px 0 4px" class="b3-text-field fn__block" placeholder="${options.data.name} ${colData.name}">
</div>
<div class="b3-menu__item fn__flex-column fn__none" data-type="nobg">
    <button style="margin: 4px 0 8px;" class="b3-button fn__block" data-type="updateRelation">${window.siyuan.languages.confirm}</button>
</div>`;
    } else if (colData.type === "rollup") {
        html += '<button class="b3-menu__separator"></button>' + getRollupHTML({colData});
    } else if (colData.type === "date") {
        html += `<button class="b3-menu__separator"></button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fillCreated}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="fillCreated" type="checkbox" class="b3-switch b3-switch--menu" ${colData.date?.autoFillNow ? "checked" : ""}>
</label>`;
    }
    if (colData.type !== "block") {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="${colData.hidden ? "showCol" : "hideCol"}">
    <svg class="b3-menu__icon" style=""><use xlink:href="#icon${colData.hidden ? "Eye" : "Eyeoff"}"></use></svg>
    <span class="b3-menu__label">${colData.hidden ? window.siyuan.languages.showCol : window.siyuan.languages.hideCol}</span>
</button>
<button class="b3-menu__item${colData.type === "relation" ? " fn__none" : ""}" data-type="duplicateCol">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconCopy"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.duplicate}</span>
</button>
<button class="b3-menu__item" data-type="removeCol">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>`;
    }
    return `<div class="b3-menu__items">
    ${html}
    <button class="b3-menu__separator"></button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.wrap}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="wrap" type="checkbox" class="b3-switch b3-switch--menu" ${colData.wrap ? " checked" : ""}>
    </label>
</div>
<div class="b3-menu__items fn__none">
    <button class="b3-menu__item" data-type="nobg" data-col-id="${colData.id}">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goEditCol">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.edit}</span>
    </button>
    <button class="b3-menu__separator"></button>
    ${genUpdateColItem("text", colData.type)}
    ${genUpdateColItem("number", colData.type)}
    ${genUpdateColItem("select", colData.type)}
    ${genUpdateColItem("mSelect", colData.type)}
    ${genUpdateColItem("date", colData.type)}
    ${genUpdateColItem("mAsset", colData.type)}
    ${genUpdateColItem("checkbox", colData.type)}
    ${genUpdateColItem("url", colData.type)}
    ${genUpdateColItem("email", colData.type)}
    ${genUpdateColItem("phone", colData.type)}
    ${genUpdateColItem("template", colData.type)}
    ${genUpdateColItem("relation", colData.type)}
    ${genUpdateColItem("rollup", colData.type)}
    ${genUpdateColItem("lineNumber", colData.type)}
    ${genUpdateColItem("created", colData.type)}
    ${genUpdateColItem("updated", colData.type)}
</div>`;
};

export const bindEditEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    blockID: string,
    menuElement: HTMLElement,
    isCustomAttr: boolean
}) => {
    const avID = options.data.id;
    const colId = options.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    const colData = options.data.view.columns.find((item: IAVColumn) => item.id === colId);
    const nameElement = options.menuElement.querySelector('[data-type="name"]') as HTMLInputElement;
    nameElement.addEventListener("blur", () => {
        const newValue = nameElement.value;
        if (newValue === colData.name) {
            return;
        }
        transaction(options.protyle, [{
            action: "updateAttrViewCol",
            id: colId,
            avID,
            name: newValue,
            type: colData.type,
        }], [{
            action: "updateAttrViewCol",
            id: colId,
            avID,
            name: colData.name,
            type: colData.type,
        }]);
        colData.name = newValue;
        updateAttrViewCellAnimation(options.protyle.wysiwyg.element.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {name: newValue});
    });
    nameElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Escape") {
            options.menuElement.parentElement.remove();
        } else if (event.key === "Enter") {
            nameElement.dispatchEvent(new CustomEvent("blur"));
            options.menuElement.parentElement.remove();
        }
    });
    nameElement.addEventListener("keyup", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        const inputElement = options.menuElement.querySelector('[data-type="colName"]') as HTMLInputElement;
        if (inputElement) {
            inputElement.setAttribute("placeholder", `${options.data.name} ${nameElement.value}`);
        }
    });
    nameElement.select();
    const tplElement = options.menuElement.querySelector('[data-type="updateTemplate"]') as HTMLTextAreaElement;
    if (tplElement) {
        tplElement.addEventListener("blur", () => {
            const newValue = tplElement.value;
            if (newValue === colData.template) {
                return;
            }
            transaction(options.protyle, [{
                action: "updateAttrViewColTemplate",
                id: colId,
                avID,
                data: newValue,
                type: colData.type,
            }], [{
                action: "updateAttrViewColTemplate",
                id: colId,
                avID,
                data: colData.template,
                type: colData.type,
            }]);
            colData.template = newValue;
        });
        tplElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape") {
                options.menuElement.parentElement.remove();
            } else if (event.key === "Enter" && !event.shiftKey) {
                tplElement.dispatchEvent(new CustomEvent("blur"));
                options.menuElement.parentElement.remove();
            }
        });
    }

    const wrapElement = options.menuElement.querySelector('.b3-switch[data-type="wrap"]') as HTMLInputElement;
    if (wrapElement) {
        wrapElement.addEventListener("change", () => {
            transaction(options.protyle, [{
                action: "setAttrViewColWrap",
                id: colId,
                avID,
                data: wrapElement.checked,
                blockID: options.blockID
            }], [{
                action: "setAttrViewColWrap",
                id: colId,
                avID,
                data: !wrapElement.checked,
                blockID: options.blockID
            }]);
        });
    }

    const addOptionElement = options.menuElement.querySelector('[data-type="addOption"]') as HTMLInputElement;
    if (addOptionElement) {
        addOptionElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape") {
                options.menuElement.parentElement.remove();
            }
            if (event.key === "Enter") {
                let hasSelected = false;
                colData.options.find((item) => {
                    if (addOptionElement.value === item.name) {
                        hasSelected = true;
                        return true;
                    }
                });
                if (hasSelected || !addOptionElement.value) {
                    return;
                }
                colData.options.push({
                    color: (colData.options.length + 1).toString(),
                    name: addOptionElement.value
                });
                transaction(options.protyle, [{
                    action: "updateAttrViewColOptions",
                    id: colId,
                    avID,
                    data: colData.options
                }], [{
                    action: "removeAttrViewColOption",
                    id: colId,
                    avID,
                    data: addOptionElement.value
                }]);
                options.menuElement.innerHTML = getEditHTML({
                    protyle: options.protyle,
                    colId,
                    data: options.data,
                    isCustomAttr: options.isCustomAttr
                });
                bindEditEvent({
                    protyle: options.protyle,
                    menuElement: options.menuElement,
                    data: options.data,
                    isCustomAttr: options.isCustomAttr,
                    blockID: options.blockID
                });
                (options.menuElement.querySelector('[data-type="addOption"]') as HTMLInputElement).focus();
            }
        });
    }

    const fillCreatedElement = options.menuElement.querySelector('[data-type="fillCreated"]') as HTMLInputElement;
    if (fillCreatedElement) {
        fillCreatedElement.addEventListener("change", () => {
            transaction(options.protyle, [{
                avID,
                action: "setAttrViewColDate",
                id: colId,
                data: fillCreatedElement.checked
            }], [{
                avID,
                action: "setAttrViewColDate",
                id: colId,
                data: !fillCreatedElement.checked
            }]);
        });
    }

    const backRelationElement = options.menuElement.querySelector('[data-type="backRelation"]') as HTMLInputElement;
    if (backRelationElement) {
        backRelationElement.addEventListener("change", () => {
            toggleUpdateRelationBtn(options.menuElement, avID);
        });
        const goSearchElement = options.menuElement.querySelector('[data-type="goSearchAV"]') as HTMLElement;
        const oldValue = JSON.parse(goSearchElement.getAttribute("data-old-value"));
        const inputElement = options.menuElement.querySelector('[data-type="colName"]') as HTMLInputElement;
        inputElement.addEventListener("input", () => {
            toggleUpdateRelationBtn(options.menuElement, avID);
        });
        if (oldValue.avID) {
            fetchPost("/api/av/getAttributeView", {id: oldValue.avID}, (response) => {
                goSearchElement.querySelector(".b3-menu__accelerator").textContent = oldValue.avID === avID ? window.siyuan.languages.thisDatabase : (response.data.av.name || window.siyuan.languages.title);
                response.data.av.keyValues.find((item: { key: { id: string, name: string } }) => {
                    if (item.key.id === oldValue.backKeyID) {
                        inputElement.setAttribute("data-old-value", item.key.name || window.siyuan.languages.title);
                        inputElement.value = item.key.name || window.siyuan.languages.title;
                        return true;
                    }
                });
                toggleUpdateRelationBtn(options.menuElement, avID);
            });
        } else {
            toggleUpdateRelationBtn(options.menuElement, avID);
        }
    }
    bindRollupData(options);
};

export const getColNameByType = (type: TAVCol) => {
    switch (type) {
        case "text":
        case "number":
        case "select":
        case "date":
        case "phone":
        case "email":
        case "template":
            return window.siyuan.languages[type];
        case "mSelect":
            return window.siyuan.languages.multiSelect;
        case "relation":
            return window.siyuan.languages.relation;
        case "rollup":
            return window.siyuan.languages.rollup;
        case "updated":
            return window.siyuan.languages.updatedTime;
        case "created":
            return window.siyuan.languages.createdTime;
        case "url":
            return window.siyuan.languages.link;
        case "mAsset":
            return window.siyuan.languages.assets;
        case "checkbox":
            return window.siyuan.languages.checkbox;
        case "block":
            return window.siyuan.languages["_attrView"].key;
        case "lineNumber":
            return window.siyuan.languages.lineNumber;
    }
};

export const getColIconByType = (type: TAVCol) => {
    switch (type) {
        case "text":
            return "iconAlignLeft";
        case "block":
            return "iconKey";
        case "number":
            return "iconNumber";
        case "select":
            return "iconListItem";
        case "mSelect":
            return "iconList";
        case "relation":
            return "iconOpen";
        case "rollup":
            return "iconSearch";
        case "date":
            return "iconCalendar";
        case "updated":
        case "created":
            return "iconClock";
        case "url":
            return "iconLink";
        case "mAsset":
            return "iconImage";
        case "email":
            return "iconEmail";
        case "phone":
            return "iconPhone";
        case "template":
            return "iconMath";
        case "checkbox":
            return "iconCheck";
        case "lineNumber":
            return "iconOrderedList";
    }
};

const addAttrViewColAnimation = (options: {
    blockElement: Element,
    protyle: IProtyle,
    type: TAVCol,
    name: string,
    id: string,
    icon?: string,
    previousID: string,
    data?: IAV
}) => {
    if (!options.blockElement) {
        return;
    }
    const nodeId = options.blockElement.getAttribute("data-node-id");
    if (options.blockElement.classList.contains("av")) {
        options.blockElement.querySelectorAll(".av__row").forEach((item, index) => {
            let previousElement;
            if (options.previousID) {
                previousElement = item.querySelector(`[data-col-id="${options.previousID}"]`);
            } else {
                previousElement = item.lastElementChild.previousElementSibling;
            }
            let html = "";
            if (index === 0) {
                // av__pulse 用于检测是否新增，和 render 中 isPulse 配合弹出菜单
                html = `<div class="av__cell av__cell--header" draggable="true" data-icon="${options.icon || ""}" data-col-id="${options.id}" data-dtype="${options.type}" data-wrap="false" style="width: 200px;">
    ${options.icon ? unicode2Emoji(options.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(options.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${options.name}</span>
    <div class="av__widthdrag av__pulse"></div>
</div>`;
            } else {
                html = '<div class="av__cell" style="width: 200px"><span class="av__pulse"></span></div>';
            }
            previousElement.insertAdjacentHTML("afterend", html);
        });
    } else {
        options.blockElement.querySelector(".fn__hr").insertAdjacentHTML("beforebegin", `<div class="block__icons av__row" data-id="${nodeId}" data-col-id="${options.id}">
    <div class="block__icon" draggable="true"><svg><use xlink:href="#iconDrag"></use></svg></div>
    <div class="block__logo ariaLabel fn__pointer" data-type="editCol" data-position="parentW" aria-label="${getColNameByType(options.type)}">
        <svg class="block__logoicon"><use xlink:href="#${getColIconByType(options.type)}"></use></svg>
        <span>${getColNameByType(options.type)}</span>
    </div>
    <div data-col-id="${options.id}" data-block-id="${nodeId}" data-type="${options.type}" data-options="[]" class="fn__flex-1 fn__flex">
        <div class="fn__flex-1"></div>
    </div>
</div>`);
    }
    const menuElement = document.querySelector(".av__panel .b3-menu") as HTMLElement;
    if (menuElement && options.data && options.blockElement.classList.contains("av")) {
        menuElement.innerHTML = getEditHTML({
            protyle: options.protyle,
            data: options.data,
            colId: options.id,
            isCustomAttr: false
        });
        bindEditEvent({
            protyle: options.protyle,
            data: options.data,
            menuElement,
            isCustomAttr: false,
            blockID: nodeId
        });
        const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
        if (tabRect) {
            setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height);
        }
        return;
    }
    openMenuPanel({
        protyle: options.protyle,
        blockElement: options.blockElement,
        type: "edit",
        colId: options.id,
        editData: {
            previousID: options.previousID,
            colData: genColDataByType(options.type, options.id, options.name),
        }
    });
    window.siyuan.menus.menu.remove();
};

export const showColMenu = (protyle: IProtyle, blockElement: Element, cellElement: HTMLElement) => {
    const type = cellElement.getAttribute("data-dtype") as TAVCol;
    const colId = cellElement.getAttribute("data-col-id");
    const avID = blockElement.getAttribute("data-av-id");
    const blockID = blockElement.getAttribute("data-node-id");
    const oldValue = cellElement.querySelector(".av__celltext").textContent.trim();
    const menu = new Menu("av-header-cell", () => {
        const newValue = (menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
        if (newValue === oldValue) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewCol",
            id: colId,
            avID,
            name: newValue,
            type,
        }], [{
            action: "updateAttrViewCol",
            id: colId,
            avID,
            name: oldValue,
            type,
        }]);
        updateAttrViewCellAnimation(blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {name: newValue});
        // https://github.com/siyuan-note/siyuan/issues/9862
        focusBlock(blockElement);
    });
    menu.addItem({
        iconHTML: `<span style="align-self: center;margin-right: 8px;width: 14px;" class="block__icon block__icon--show">${cellElement.dataset.icon ? unicode2Emoji(cellElement.dataset.icon) : `<svg><use xlink:href="#${getColIconByType(type)}"></use></svg>`}</span>`,
        type: "readonly",
        label: `<input style="margin: 4px 0" class="b3-text-field fn__block fn__size200" type="text" value="${oldValue}">`,
        bind(element) {
            const iconElement = element.querySelector(".block__icon") as HTMLElement;
            iconElement.setAttribute("data-icon", cellElement.dataset.icon);
            iconElement.addEventListener("click", (event) => {
                const rect = iconElement.getBoundingClientRect();
                openEmojiPanel("", "av", {
                    x: rect.left,
                    y: rect.bottom,
                    h: rect.height,
                    w: rect.width
                }, (unicode) => {
                    transaction(protyle, [{
                        action: "setAttrViewColIcon",
                        id: colId,
                        avID,
                        data: unicode,
                    }], [{
                        action: "setAttrViewColIcon",
                        id: colId,
                        avID,
                        data: cellElement.dataset.icon,
                    }]);
                    iconElement.setAttribute("data-icon", unicode);
                    iconElement.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg><use xlink:href="#${getColIconByType(type)}"></use></svg>`;
                    updateAttrViewCellAnimation(blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {icon: unicode});
                });
                event.preventDefault();
                event.stopPropagation();
            });
            element.querySelector("input").addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                    event.preventDefault();
                }
            });
        }
    });
    menu.addItem({
        icon: "iconEdit",
        label: window.siyuan.languages.edit,
        click() {
            const colName = (menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
            openMenuPanel({
                protyle,
                blockElement,
                type: "edit",
                colId,
                cb(avElement) {
                    // 修改名字后点击编辑，需要更新名字
                    const editNameElement = avElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement;
                    editNameElement.value = colName;
                    editNameElement.select();
                }
            });
        }
    });
    menu.addSeparator();

    // 行号 类型不参与 排序和筛选
    if (type !== "lineNumber") {
        menu.addItem({
            icon: "iconUp",
            label: window.siyuan.languages.asc,
            click() {
                fetchPost("/api/av/renderAttributeView", {
                    id: avID,
                }, (response) => {
                    transaction(protyle, [{
                        action: "setAttrViewSorts",
                        avID: response.data.id,
                        data: [{
                            column: colId,
                            order: "ASC"
                        }],
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID: response.data.id,
                        data: response.data.view.sorts,
                        blockID
                    }]);
                });
            }
        });
        menu.addItem({
            icon: "iconDown",
            label: window.siyuan.languages.desc,
            click() {
                fetchPost("/api/av/renderAttributeView", {
                    id: avID,
                }, (response) => {
                    transaction(protyle, [{
                        action: "setAttrViewSorts",
                        avID: response.data.id,
                        data: [{
                            column: colId,
                            order: "DESC"
                        }],
                        blockID
                    }], [{
                        action: "setAttrViewSorts",
                        avID: response.data.id,
                        data: response.data.view.sorts,
                        blockID
                    }]);
                });
            }
        });
        if (type !== "mAsset") {
            menu.addItem({
                icon: "iconFilter",
                label: window.siyuan.languages.filter,
                click() {
                    fetchPost("/api/av/renderAttributeView", {
                        id: avID,
                    }, (response) => {
                        const avData = response.data as IAV;
                        let filter: IAVFilter;
                        avData.view.filters.find((item) => {
                            if (item.column === colId && item.value.type === type) {
                                filter = item;
                                return true;
                            }
                        });
                        if (!filter) {
                            filter = {
                                column: colId,
                                operator: getDefaultOperatorByType(type),
                                value: genCellValue(type, ""),
                            };
                            avData.view.filters.push(filter);
                        }
                        setFilter({
                            filter,
                            protyle,
                            data: avData,
                            blockElement: blockElement,
                            target: blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`),
                        });
                    });
                }
            });
        }
        menu.addSeparator();
    }
    menu.addItem({
        icon: "iconInsertLeft",
        label: window.siyuan.languages.insertColumnLeft,
        click() {
            const addMenu = addCol(protyle, blockElement, cellElement.previousElementSibling?.getAttribute("data-col-id") || "");
            if (!blockElement.contains(cellElement)) {
                cellElement = blockElement.querySelector(`.av__row--header .av__cell--header[data-col-id="${colId}"]`);
            }
            const addRect = cellElement.getBoundingClientRect();
            addMenu.open({
                x: addRect.left,
                y: addRect.bottom,
                h: addRect.height
            });
        }
    });
    menu.addItem({
        icon: "iconInsertRight",
        label: window.siyuan.languages.insertColumnRight,
        click() {
            const addMenu = addCol(protyle, blockElement, colId);
            if (!blockElement.contains(cellElement)) {
                cellElement = blockElement.querySelector(`.av__row--header .av__cell--header[data-col-id="${colId}"]`);
            }
            const addRect = cellElement.getBoundingClientRect();
            addMenu.open({
                x: addRect.left,
                y: addRect.bottom,
                h: addRect.height
            });
        }
    });
    if (type !== "block") {
        menu.addItem({
            icon: "iconEyeoff",
            label: window.siyuan.languages.hide,
            click() {
                transaction(protyle, [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID,
                    data: true,
                    blockID
                }], [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    avID,
                    data: false,
                    blockID
                }]);
            }
        });
    }
    const isPin = cellElement.dataset.pin === "true";
    menu.addItem({
        icon: isPin ? "iconUnpin" : "iconPin",
        label: isPin ? window.siyuan.languages.unfreezeCol : window.siyuan.languages.freezeCol,
        click() {
            transaction(protyle, [{
                action: "setAttrViewColPin",
                id: colId,
                avID,
                data: !isPin,
                blockID
            }], [{
                action: "setAttrViewColPin",
                id: colId,
                avID,
                data: isPin,
                blockID
            }]);
            updateAttrViewCellAnimation(blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {pin: !isPin});
        }
    });
    if (type !== "block") {
        if (type !== "relation") {
            menu.addItem({
                icon: "iconCopy",
                label: window.siyuan.languages.duplicate,
                click() {
                    fetchPost("/api/av/renderAttributeView", {
                        id: avID,
                    }, (response) => {
                        duplicateCol({
                            blockElement,
                            viewID: blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW),
                            protyle,
                            colId,
                            data: response.data
                        });
                    });
                }
            });
        }
        menu.addItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            click() {
                const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                transaction(protyle, [{
                    action: "removeAttrViewCol",
                    id: colId,
                    avID,
                }, {
                    action: "doUpdateUpdated",
                    id: blockID,
                    data: newUpdated,
                }], [{
                    action: "addAttrViewCol",
                    name: oldValue,
                    avID,
                    type: type,
                    id: colId,
                    previousID: cellElement.previousElementSibling?.getAttribute("data-col-id") || "",
                }, {
                    action: "doUpdateUpdated",
                    id: blockID,
                    data: blockElement.getAttribute("updated")
                }]);
                removeAttrViewColAnimation(blockElement, colId);
                blockElement.setAttribute("updated", newUpdated);
            }
        });
        menu.addSeparator();
    }
    menu.addItem({
        label: `<label class="fn__flex"><span class="fn__flex-center">${window.siyuan.languages.wrap}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch b3-switch--menu"${cellElement.dataset.wrap === "true" ? " checked" : ""}></label>`,
        bind(element) {
            const inputElement = element.querySelector("input") as HTMLInputElement;
            inputElement.addEventListener("change", () => {
                transaction(protyle, [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    avID,
                    data: inputElement.checked,
                    blockID
                }], [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    avID,
                    data: !inputElement.checked,
                    blockID
                }]);
            });
        }
    });
    const cellRect = cellElement.getBoundingClientRect();
    menu.open({
        x: cellRect.left,
        y: cellRect.bottom,
        h: cellRect.height
    });
    const inputElement = window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement;
    if (inputElement) {
        inputElement.select();
        inputElement.focus();
    }
};

const genUpdateColItem = (type: TAVCol, oldType: TAVCol) => {
    return `<button class="b3-menu__item" data-type="updateColType" data-old-type="${oldType}" data-new-type="${type}">
    <svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(type)}"></use></svg>
    <span class="b3-menu__label">${getColNameByType(type)}</span>
    ${type === oldType ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg></span>' : ""}
</button>`;
};

export const addCol = (protyle: IProtyle, blockElement: Element, previousID?: string) => {
    const menu = new Menu("av-header-add");
    const avID = blockElement.getAttribute("data-av-id");
    if (typeof previousID === "undefined") {
        previousID = Array.from(blockElement.querySelectorAll(".av__row--header .av__cell")).pop().getAttribute("data-col-id");
    }
    const blockId = blockElement.getAttribute("data-node-id");
    menu.addItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.text,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.text,
                avID,
                type: "text",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "text",
                name: window.siyuan.languages.text,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconNumber",
        label: window.siyuan.languages.number,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.number,
                avID,
                type: "number",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "number",
                name: window.siyuan.languages.number,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconListItem",
        label: window.siyuan.languages.select,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.select,
                avID,
                type: "select",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "select",
                name: window.siyuan.languages.select,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.multiSelect,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.multiSelect,
                avID,
                type: "mSelect",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "mSelect",
                name: window.siyuan.languages.multiSelect,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconCalendar",
        label: window.siyuan.languages.date,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.date,
                avID,
                type: "date",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "date",
                name: window.siyuan.languages.date,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconImage",
        label: window.siyuan.languages.assets,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.assets,
                avID,
                type: "mAsset",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "mAsset",
                name: window.siyuan.languages.assets,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconCheck",
        label: window.siyuan.languages.checkbox,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.checkbox,
                avID,
                type: "checkbox",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "checkbox",
                name: window.siyuan.languages.checkbox,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconLink",
        label: window.siyuan.languages.link,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.link,
                avID,
                type: "url",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "url",
                name: window.siyuan.languages.link,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconEmail",
        label: window.siyuan.languages.email,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.email,
                avID,
                type: "email",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "email",
                name: window.siyuan.languages.email,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconPhone",
        label: window.siyuan.languages.phone,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.phone,
                avID,
                type: "phone",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "phone",
                name: window.siyuan.languages.phone,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconMath",
        label: window.siyuan.languages.template,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.template,
                avID,
                type: "template",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "template",
                name: window.siyuan.languages.template,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconOpen",
        label: window.siyuan.languages.relation,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.relation,
                avID,
                type: "relation",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "relation",
                name: window.siyuan.languages.relation,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconSearch",
        label: window.siyuan.languages.rollup,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.rollup,
                avID,
                type: "rollup",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "rollup",
                name: window.siyuan.languages.rollup,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    // 在创建时间前插入 lineNumber
    menu.addItem({
        icon: "iconOrderedList",
        label: window.siyuan.languages.lineNumber,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.lineNumber,
                avID,
                type: "lineNumber",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "lineNumber",
                name: window.siyuan.languages.lineNumber,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconClock",
        label: window.siyuan.languages.createdTime,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.createdTime,
                avID,
                type: "created",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "created",
                name: window.siyuan.languages.createdTime,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    menu.addItem({
        icon: "iconClock",
        label: window.siyuan.languages.updatedTime,
        click() {
            const id = Lute.NewNodeID();
            const newUpdated = dayjs().format("YYYYMMDDHHmmss");
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.updatedTime,
                avID,
                type: "updated",
                id,
                previousID
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: newUpdated,
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }, {
                action: "doUpdateUpdated",
                id: blockId,
                data: blockElement.getAttribute("updated")
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "updated",
                name: window.siyuan.languages.updatedTime,
                id,
                previousID
            });
            blockElement.setAttribute("updated", newUpdated);
        }
    });
    return menu;
};

const genColDataByType = (type: TAVCol, id: string, name: string) => {
    const colData: IAVColumn = {
        hidden: false,
        icon: "",
        id,
        name,
        numberFormat: "",
        pin: false,
        template: "",
        type,
        width: "",
        wrap: false,
        calc: null
    };
    return colData;
};
