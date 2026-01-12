import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {fetchPost, fetchSyncPost} from "../../../util/fetch";
import {getDefaultOperatorByType, setFilter} from "./filter";
import {genCellValue} from "./cell";
import {getPropertiesHTML, openMenuPanel} from "./openMenuPanel";
import {getLabelByNumberFormat} from "./number";
import {removeAttrViewColAnimation, updateAttrViewCellAnimation} from "./action";
import {openEmojiPanel, unicode2Emoji} from "../../../emoji";
import {focusBlock} from "../../util/selection";
import {toggleUpdateRelationBtn} from "./relation";
import {bindRollupData, getRollupHTML} from "./rollup";
import {Constants} from "../../../constants";
import * as dayjs from "dayjs";
import {setPosition} from "../../../util/setPosition";
import {duplicateNameAddOne, isMobile} from "../../../util/functions";
import {Dialog} from "../../../dialog";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {getFieldsByData} from "./view";
import {hasClosestByClassName} from "../../util/hasClosest";

export const getColId = (element: Element, viewType: TAVView) => {
    if (viewType === "table" || hasClosestByClassName(element, "custom-attr")) {
        return element.getAttribute("data-col-id");
    } else if (["gallery", "kanban"].includes(viewType)) {
        return element.getAttribute("data-field-id");
    }
};

export const duplicateCol = (options: {
    protyle: IProtyle,
    colId: string,
    viewID: string,
    blockElement: Element,
    data: IAV,
}) => {
    let newColData: IAVColumn;
    const fields = getFieldsByData(options.data);
    fields.find((item: IAVColumn, index) => {
        if (item.id === options.colId) {
            newColData = JSON.parse(JSON.stringify(item));
            fields.splice(index + 1, 0, newColData);
            return true;
        }
    });
    newColData.name = duplicateNameAddOne(newColData.name);
    newColData.id = Lute.NewNodeID();
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    const blockId = options.blockElement.getAttribute("data-node-id");
    transaction(options.protyle, [{
        action: "duplicateAttrViewKey",
        keyID: options.colId,
        nextID: newColData.id,
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
    getFieldsByData(options.data).find((item) => {
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
<button class="b3-menu__separator" data-id="separator_1"></button>
<button class="b3-menu__item" data-type="nobg">
    <div class="fn__block">
        <div class="fn__flex">
            <span class="b3-menu__avemoji" data-col-type="${colData.type}" data-icon="${colData.icon}" data-type="update-icon">${colData.icon ? unicode2Emoji(colData.icon) : `<svg style="width: 14px;height: 14px"><use xlink:href="#${getColIconByType(colData.type)}"></use></svg>`}</span>
            <div class="b3-form__icona fn__block">
                <input data-type="name" class="b3-text-field b3-form__icona-input" type="text">
                <svg data-position="north" class="b3-form__icona-icon ariaLabel" aria-label="${colData.desc ? escapeAriaLabel(colData.desc) : window.siyuan.languages.addDesc}"><use xlink:href="#iconInfo"></use></svg>
            </div>
        </div>
        <div class="fn__none">
            <div class="fn__hr"></div>
            <textarea placeholder="${window.siyuan.languages.addDesc}" rows="1" data-type="desc" class="b3-text-field fn__block" type="text" data-value="${escapeAttr(colData.desc)}">${colData.desc}</textarea>
        </div>
        <div class="fn__hr--small"></div>
    </div>
</button>
<button class="b3-menu__item" data-type="goUpdateColType" ${colData.type === "block" ? "disabled" : ""}>
    <span class="b3-menu__label">${window.siyuan.languages.type}</span>
    <span class="fn__space"></span>
    <svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(colData.type)}"></use></svg>
    <span class="b3-menu__accelerator" style="margin-left: 0">${getColNameByType(colData.type)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>`;
    if (["mSelect", "select"].includes(colData.type)) {
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
<button class="b3-menu__item" data-type="nobg">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <input data-type="addOption" class="b3-text-field fn__block" type="text" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.addAttr}" style="margin: 4px 0">
</button>`;
        if (!colData.options) {
            colData.options = [];
        }
        colData.options.forEach(item => {
            const airaLabel = item.desc ? `${escapeAriaLabel(item.name)}<div class='ft__on-surface'>${escapeAriaLabel(item.desc || "")}</div>` : "";
            html += `<button class="b3-menu__item${html ? "" : " b3-menu__item--current"}" draggable="true" data-name="${escapeAttr(item.name)}" data-desc="${escapeAttr(item.desc || "")}" data-color="${item.color}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="fn__flex-1 ariaLabel" data-position="parentW" aria-label="${airaLabel}">
        <span class="b3-chip" style="background-color:var(--b3-font-background${item.color});color:var(--b3-font-color${item.color})">
            <span class="fn__ellipsis">${escapeHtml(item.name)}</span>
        </span>
    </div>
    <svg class="b3-menu__action" data-type="setColOption"><use xlink:href="#iconEdit"></use></svg>
</button>`;
        });
    } else if (colData.type === "number") {
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
<button class="b3-menu__item" data-type="numberFormat" data-format="${colData.numberFormat}">
    <svg class="b3-menu__icon"><use xlink:href="#iconFormat"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.format}</span>
    <span class="b3-menu__accelerator">${getLabelByNumberFormat(colData.numberFormat)}</span>
</button>`;
    } else if (colData.type === "template") {
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
<button class="b3-menu__item" data-type="nobg">
    <textarea spellcheck="false" rows="${Math.min(colData.template.split("\n").length, 8)}" placeholder="${window.siyuan.languages.template}" data-type="updateTemplate" style="margin: 4px 0" rows="1" class="fn__block b3-text-field">${colData.template}</textarea>
</button>`;
    } else if (colData.type === "relation") {
        const isSelf = colData.relation?.avID === options.data.id;
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
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
        html += '<button class="b3-menu__separator" data-id="separator_2"></button>' + getRollupHTML({colData});
    } else if (colData.type === "date") {
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fillCreated}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="fillCreated" type="checkbox" class="b3-switch b3-switch--menu" ${colData.date?.autoFillNow ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fillSpecificTime}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="fillSpecificTime" type="checkbox" class="b3-switch b3-switch--menu" ${colData.date?.fillSpecificTime ? "checked" : ""}>
</label>`;
    } else if (["updated", "created"].includes(colData.type)) {
        html += `<button class="b3-menu__separator" data-id="separator_2"></button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.includeTime}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="includeTime" type="checkbox" class="b3-switch b3-switch--menu" ${(!colData[colData.type as "updated"] || colData[colData.type as "updated"].includeTime) ? "checked" : ""}>
</label>`;
    }
    html += `<button class="b3-menu__separator" data-id="separator_3"></button>
<label class="b3-menu__item">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconSoftWrap"></use></svg>
    <span class="fn__flex-center">${window.siyuan.languages.wrap}</span>
    <span class="fn__space fn__flex-1"></span>
    <input type="checkbox" data-type="wrap" class="b3-switch b3-switch--menu"${colData.wrap ? " checked" : ""}>
</label>`;
    if (colData.type !== "block") {
        html += `<button class="b3-menu__item${colData.type === "relation" ? " fn__none" : ""}" data-type="duplicateCol">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconCopy"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.duplicate}</span>
</button>
<button class="b3-menu__item  b3-menu__item--warning" data-type="removeCol">
    <svg class="b3-menu__icon" style=""><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>`;
    }
    return `<div class="b3-menu__items">
    ${html}
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
    const colData = getFieldsByData(options.data).find((item: IAVColumn) => item.id === colId);
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
    nameElement.value = colData.name;
    const descElement = options.menuElement.querySelector('.b3-text-field[data-type="desc"]') as HTMLTextAreaElement;
    nameElement.nextElementSibling.addEventListener("click", () => {
        const descPanelElement = descElement.parentElement;
        descPanelElement.classList.toggle("fn__none");
        if (!descPanelElement.classList.contains("fn__none")) {
            descElement.focus();
        }
    });
    descElement.addEventListener("blur", () => {
        const newValue = descElement.value;
        if (newValue === colData.desc) {
            return;
        }
        transaction(options.protyle, [{
            action: "setAttrViewColDesc",
            id: colId,
            avID,
            data: newValue,
        }], [{
            action: "setAttrViewColDesc",
            id: colId,
            avID,
            data: colData.desc,
        }]);
        colData.desc = newValue;
    });
    descElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Escape") {
            options.menuElement.parentElement.remove();
        } else if (event.key === "Enter") {
            descElement.dispatchEvent(new CustomEvent("blur"));
            options.menuElement.parentElement.remove();
        }
    });
    descElement.addEventListener("input", () => {
        nameElement.nextElementSibling.setAttribute("aria-label", descElement.value ? escapeHtml(descElement.value) : window.siyuan.languages.addDesc);
    });
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

    const includeTimeElement = options.menuElement.querySelector('.b3-switch[data-type="includeTime"]') as HTMLInputElement;
    if (includeTimeElement) {
        includeTimeElement.addEventListener("change", () => {
            transaction(options.protyle, [{
                action: colData.type === "updated" ? "setAttrViewUpdatedIncludeTime" : "setAttrViewCreatedIncludeTime",
                id: colId,
                avID,
                data: includeTimeElement.checked,
            }], [{
                action: colData.type === "updated" ? "setAttrViewUpdatedIncludeTime" : "setAttrViewCreatedIncludeTime",
                id: colId,
                avID,
                data: !includeTimeElement.checked,
            }]);
            if (colData[colData.type as "updated"]) {
                colData[colData.type as "updated"].includeTime = includeTimeElement.checked;
            } else {
                colData[colData.type as "updated"] = {includeTime: includeTimeElement.checked};
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
                blockID: options.blockID,
                viewID: options.data.viewID,
            }], [{
                action: "setAttrViewColWrap",
                id: colId,
                avID,
                data: !wrapElement.checked,
                viewID: options.data.viewID,
                blockID: options.blockID
            }]);
            colData.wrap = wrapElement.checked;
            options.data.view.wrapField = options.data.view.wrapField && wrapElement.checked;
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
                    color: ((colData.options.length || 0) % 14 + 1).toString(),
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
                action: "setAttrViewColDateFillCreated",
                id: colId,
                data: fillCreatedElement.checked
            }], [{
                avID,
                action: "setAttrViewColDateFillCreated",
                id: colId,
                data: !fillCreatedElement.checked
            }]);
        });
    }

    const fillSpecificTimeElement = options.menuElement.querySelector('[data-type="fillSpecificTime"]') as HTMLInputElement;
    if (fillSpecificTimeElement) {
        fillSpecificTimeElement.addEventListener("change", () => {
            transaction(options.protyle, [{
                avID,
                action: "setAttrViewColDateFillSpecificTime",
                id: colId,
                data: fillSpecificTimeElement.checked
            }], [{
                avID,
                action: "setAttrViewColDateFillSpecificTime",
                id: colId,
                data: !fillSpecificTimeElement.checked
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
                goSearchElement.querySelector(".b3-menu__accelerator").textContent = oldValue.avID === avID ? window.siyuan.languages.thisDatabase : (response.data.av.name || window.siyuan.languages._kernel[267]);
                response.data.av.keyValues.find((item: { key: { id: string, name: string } }) => {
                    if (item.key.id === oldValue.backKeyID) {
                        inputElement.setAttribute("data-old-value", item.key.name || window.siyuan.languages._kernel[272]);
                        inputElement.value = item.key.name || window.siyuan.languages._kernel[272];
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
        options.blockElement.querySelectorAll(".av__row").forEach((item) => {
            let previousElement;
            if (options.previousID) {
                previousElement = item.querySelector(`[data-col-id="${options.previousID}"]`);
            } else {
                previousElement = item.querySelector(".av__cell").previousElementSibling;
            }
            let html = "";
            if (item.classList.contains("av__row--header")) {
                html = `<div class="av__cell av__cell--header" draggable="true" data-icon="${options.icon || ""}" data-col-id="${options.id}" data-dtype="${options.type}" data-wrap="false" style="width: 200px;">
    ${options.icon ? unicode2Emoji(options.icon, "av__cellheadericon", true) : `<svg class="av__cellheadericon"><use xlink:href="#${getColIconByType(options.type)}"></use></svg>`}
    <span class="av__celltext fn__flex-1">${options.name}</span>
    <div class="av__widthdrag"></div>
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
    // https://github.com/siyuan-note/siyuan/issues/14724
    let colData;
    if (options.data) {
        colData = getFieldsByData(options.data).find((item => item.id === options.id));
    }
    openMenuPanel({
        protyle: options.protyle,
        blockElement: options.blockElement,
        type: "edit",
        colId: options.id,
        editData: {
            previousID: options.previousID,
            colData: colData || genColDataByType(options.type, options.id, options.name),
        }
    });
    window.siyuan.menus.menu.remove();
};

export const showColMenu = (protyle: IProtyle, blockElement: Element, cellElement: HTMLElement) => {
    const type = cellElement.getAttribute("data-dtype") as TAVCol;
    const colId = cellElement.getAttribute("data-col-id");
    const avID = blockElement.getAttribute("data-av-id");
    const blockID = blockElement.getAttribute("data-node-id");
    const viewID = blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const oldValue = cellElement.querySelector(".av__celltext").textContent.trim();
    const oldDesc = cellElement.dataset.desc;
    const menu = new Menu(Constants.MENU_AV_HEADER_CELL, () => {
        const newValue = (menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
        if (newValue !== oldValue) {
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
        }
        const newDesc = menu.element.querySelector("textarea").value;
        if (newDesc !== oldDesc) {
            transaction(protyle, [{
                action: "setAttrViewColDesc",
                id: colId,
                avID,
                data: newDesc,
            }], [{
                action: "setAttrViewColDesc",
                id: colId,
                avID,
                data: oldDesc,
            }]);
        }
        // https://github.com/siyuan-note/siyuan/issues/9862
        focusBlock(blockElement);
    });
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__hr"></div><div class="fn__flex">
    <div class="fn__space"></div>
    <span class="b3-menu__avemoji">${cellElement.dataset.icon ? unicode2Emoji(cellElement.dataset.icon) : `<svg style="height: 14px;width: 14px;"><use xlink:href="#${getColIconByType(type)}"></use></svg>`}</span>
    <div class="b3-form__icona fn__block">
        <input class="b3-text-field b3-form__icona-input" type="text">
        <svg data-position="north" class="b3-form__icona-icon ariaLabel" aria-label="${oldDesc ? escapeAriaLabel(oldDesc) : window.siyuan.languages.addDesc}"><use xlink:href="#iconInfo"></use></svg>
    </div>
    <div class="fn__space"></div>
</div>
<div class="fn__none">
    <div class="fn__hr"></div>
    <div class="fn__flex">
        <span class="fn__space"></span>
        <textarea placeholder="${window.siyuan.languages.addDesc}" rows="1" class="b3-text-field fn__block" type="text" data-value="${escapeAttr(oldDesc)}">${oldDesc}</textarea>
        <span class="fn__space"></span>    
    </div>
</div>
<div class="fn__hr--small"></div>`,
        bind(element) {
            const iconElement = element.querySelector(".b3-menu__avemoji") as HTMLElement;
            iconElement.addEventListener("click", (event) => {
                const rect = iconElement.getBoundingClientRect();
                openEmojiPanel("", "av", {
                    x: rect.left,
                    y: rect.bottom + 4,
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
                    iconElement.innerHTML = unicode ? unicode2Emoji(unicode) : `<svg style="height: 14px;width: 14px"><use xlink:href="#${getColIconByType(type)}"></use></svg>`;
                    updateAttrViewCellAnimation(blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {icon: unicode});
                }, iconElement.querySelector("img"));
                event.preventDefault();
                event.stopPropagation();
            });
            const inputElement = element.querySelector("input");
            inputElement.value = oldValue;
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                    event.preventDefault();
                }
            });
            const descElement = element.querySelector("textarea");
            inputElement.nextElementSibling.addEventListener("click", () => {
                const descPanelElement = descElement.parentElement.parentElement;
                descPanelElement.classList.toggle("fn__none");
                if (!descPanelElement.classList.contains("fn__none")) {
                    descElement.focus();
                }
            });
            descElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    menu.close();
                    event.preventDefault();
                }
            });
            descElement.addEventListener("input", () => {
                inputElement.nextElementSibling.setAttribute("aria-label", descElement.value ? escapeHtml(descElement.value) : window.siyuan.languages.addDesc);
            });
        }
    });
    menu.addItem({
        id: "edit",
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
    menu.addSeparator({id: "separator_1"});

    // 行号类型不参与筛选和排序
    if (type !== "lineNumber") {
        menu.addItem({
            id: "filter",
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
                    let empty = false;
                    if (!filter) {
                        empty = true;
                        filter = {
                            column: colId,
                            operator: getDefaultOperatorByType(type),
                            value: genCellValue(type, ""),
                        };
                        avData.view.filters.push(filter);
                    }
                    setFilter({
                        empty,
                        filter,
                        protyle,
                        data: avData,
                        blockElement: blockElement,
                        target: blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`),
                    });
                });
            }
        });
        menu.addItem({
            id: "asc",
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
            id: "desc",
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
    }
    const isPin = cellElement.dataset.pin === "true";
    menu.addItem({
        id: isPin ? "unfreezeCol" : "freezeCol",
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
        menu.addItem({
            id: "hide",
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
    menu.addItem({
        icon: "iconRefresh",
        label: window.siyuan.languages.syncColWidth,
        click() {
            transaction(protyle, [{
                action: "syncAttrViewTableColWidth",
                keyID: colId,
                avID,
                id: viewID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconSoftWrap",
        label: `<label class="fn__flex fn__pointer"><span>${window.siyuan.languages.wrap}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch b3-switch--menu"${cellElement.dataset.wrap === "true" ? " checked" : ""}></label>`,
        bind(element) {
            const wrapElement = element.querySelector(".b3-switch") as HTMLInputElement;
            wrapElement.addEventListener("change", () => {
                cellElement.dataset.wrap = wrapElement.checked.toString();
                transaction(protyle, [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    avID,
                    data: wrapElement.checked,
                    blockID,
                    viewID
                }], [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    avID,
                    data: !wrapElement.checked,
                    blockID,
                    viewID
                }]);
                menu.close();
            });
        }
    });
    menu.addSeparator({id: "separator_2"});
    menu.addItem({
        id: "insertColumnLeft",
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
        id: "insertColumnRight",
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
        if (type !== "relation") {
            menu.addItem({
                id: "duplicate",
                icon: "iconCopy",
                label: window.siyuan.languages.duplicate,
                click() {
                    fetchPost("/api/av/renderAttributeView", {
                        id: avID,
                    }, (response) => {
                        duplicateCol({
                            blockElement,
                            viewID,
                            protyle,
                            colId,
                            data: response.data
                        });
                    });
                }
            });
        }
        menu.addItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            async click() {
                if (type === "relation") {
                    const response = await fetchSyncPost("/api/av/getAttributeView", {id: avID});
                    const colData = response.data.av.keyValues.find((item: {
                        key: { id: string }
                    }) => item.key.id === colId);
                    if (colData.key.relation?.isTwoWay) {
                        const relResponse = await fetchSyncPost("/api/av/getAttributeView", {id: colData.key.relation.avID});
                        const dialog = new Dialog({
                            title: window.siyuan.languages.removeColConfirm,
                            content: `<div class="b3-dialog__content">
    ${window.siyuan.languages.confirmRemoveRelationField
                                .replace("${x}", colData.key.name || window.siyuan.languages._kernel[272])
                                .replace("${y}", relResponse.data.av.name || window.siyuan.languages._kernel[267])
                                .replace("${z}", relResponse.data.av.keyValues.find((item: {
                                    key: { id: string }
                                }) => item.key.id === colData.key.relation.backKeyID).key.name || window.siyuan.languages._kernel[272])}
    <div class="fn__hr--b"></div>
    <button class="fn__block b3-button b3-button--remove" data-action="delete">${window.siyuan.languages.removeBothRelationField}</button>
    <div class="fn__hr"></div>
    <button class="fn__block b3-button b3-button--remove" data-action="keep-relation">${window.siyuan.languages.removeButKeepRelationField}</button>
    <div class="fn__hr"></div>
    <button class="fn__block b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
</div>`,
                            width: isMobile() ? "92vw" : "520px",
                        });
                        dialog.element.addEventListener("click", (event) => {
                            let target = event.target as HTMLElement;
                            const isDispatch = typeof event.detail === "string";
                            while (target && target !== dialog.element || isDispatch) {
                                const action = target.getAttribute("data-action");
                                if (action === "delete" || (isDispatch && event.detail === "Enter")) {
                                    removeColByMenu({
                                        protyle,
                                        colId,
                                        avID,
                                        blockID,
                                        oldValue,
                                        type,
                                        cellElement,
                                        blockElement,
                                        removeDest: true
                                    });
                                    dialog.destroy();
                                    break;
                                } else if (action === "keep-relation") {
                                    removeColByMenu({
                                        protyle,
                                        colId,
                                        avID,
                                        blockID,
                                        oldValue,
                                        type,
                                        cellElement,
                                        blockElement,
                                        removeDest: false
                                    });
                                    dialog.destroy();
                                    break;
                                } else if (target.classList.contains("b3-button--cancel") || (isDispatch && event.detail === "Escape")) {
                                    dialog.destroy();
                                    break;
                                }
                                target = target.parentElement;
                            }
                        });
                        dialog.element.querySelector("button").focus();
                        dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
                        return;
                    }
                }
                removeColByMenu({
                    protyle,
                    colId,
                    avID,
                    blockID,
                    oldValue,
                    type,
                    cellElement,
                    blockElement,
                    removeDest: false
                });
            }
        });
    }
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

const removeColByMenu = (options: {
    protyle: IProtyle,
    colId: string,
    avID: string,
    blockID: string,
    oldValue: string,
    type: TAVCol,
    cellElement: HTMLElement,
    blockElement: Element,
    removeDest: boolean
}) => {
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(options.protyle, [{
        action: "removeAttrViewCol",
        id: options.colId,
        avID: options.avID,
        removeDest: options.removeDest
    }, {
        action: "doUpdateUpdated",
        id: options.blockID,
        data: newUpdated,
    }], [{
        action: "addAttrViewCol",
        name: options.oldValue,
        avID: options.avID,
        type: options.type,
        id: options.colId,
        previousID: options.cellElement.previousElementSibling?.getAttribute("data-col-id") || "",
    }, {
        action: "doUpdateUpdated",
        id: options.blockID,
        data: options.blockElement.getAttribute("updated")
    }]);
    removeAttrViewColAnimation(options.blockElement, options.colId);
    options.blockElement.setAttribute("updated", newUpdated);
};

export const removeCol = (options: {
    protyle: IProtyle,
    fields: IAVColumn[],
    avID: string,
    blockID: string,
    isCustomAttr: boolean
    menuElement: HTMLElement,
    blockElement: Element
    avPanelElement: Element
    tabRect: DOMRect,
    isTwoWay: boolean
}) => {
    const colId = options.menuElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let previousID = "";
    const colData = options.fields.find((item: IAVColumn, index) => {
        if (item.id === colId) {
            previousID = options.fields[index - 1]?.id;
            options.fields.splice(index, 1);
            return true;
        }
    });
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    transaction(options.protyle, [{
        action: "removeAttrViewCol",
        id: colId,
        avID: options.avID,
        removeDest: options.isTwoWay
    }, {
        action: "doUpdateUpdated",
        id: options.blockID,
        data: newUpdated,
    }], [{
        action: "addAttrViewCol",
        name: colData.name,
        avID: options.avID,
        type: colData.type,
        id: colId,
        previousID: previousID
    }, {
        action: "doUpdateUpdated",
        id: options.blockID,
        data: options.blockElement.getAttribute("updated")
    }]);
    removeAttrViewColAnimation(options.blockElement, colId);
    options.blockElement.setAttribute("updated", newUpdated);

    if (options.isCustomAttr) {
        options.avPanelElement.remove();
    } else {
        options.menuElement.innerHTML = getPropertiesHTML(options.fields);
        setPosition(options.menuElement,
            options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom,
            options.tabRect.height);
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
    const menu = new Menu(Constants.MENU_AV_HEADER_ADD);
    const avID = blockElement.getAttribute("data-av-id");
    if (typeof previousID === "undefined" && blockElement.getAttribute("data-av-type") === "table") {
        previousID = Array.from(blockElement.querySelectorAll(".av__row--header .av__cell")).pop().getAttribute("data-col-id");
    }
    const blockId = blockElement.getAttribute("data-node-id");
    menu.addItem({
        id: "text",
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
        id: "number",
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
        id: "select",
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
        id: "multiSelect",
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
        id: "date",
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
        id: "assets",
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
        id: "checkbox",
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
        id: "link",
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
        id: "email",
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
        id: "phone",
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
        id: "template",
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
        id: "relation",
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
        id: "rollup",
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
        id: "lineNumber",
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
        id: "createdTime",
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
        id: "updatedTime",
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
        desc: "",
        numberFormat: "",
        pin: false,
        template: "",
        type,
        width: "",
        wrap: undefined,
        calc: null
    };
    return colData;
};
