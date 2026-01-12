import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName, hasTopClosestByClassName} from "../../util/hasClosest";
import {UDLRHint, upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeGreat, escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {updateCellsValue} from "./cell";
import {updateAttrViewCellAnimation} from "./action";
import {focusBlock} from "../../util/selection";
import {setPosition} from "../../../util/setPosition";
import * as dayjs from "dayjs";
import {getFieldsByData, getViewName} from "./view";
import {getColId} from "./col";
import {getFieldIdByCellElement} from "./row";
import {isMobile} from "../../../util/functions";
import {showMessage} from "../../../dialog/message";
import {writeText} from "../../util/compatibility";

interface IAVItem {
    avID: string;
    avName: string;
    blockID: string;
    hPath: string;
    viewName: string;
    viewID: string;
    viewLayout: string;
}

const genSearchList = (element: Element, keyword: string, avId?: string, excludes = true, cb?: () => void) => {
    fetchPost("/api/av/searchAttributeView", {
        keyword,
        excludes: (excludes && avId) ? [avId] : undefined
    }, (response) => {
        let html = "";
        response.data.results.forEach((item: IAVItem & { children: IAVItem[] }, index: number) => {
            const hasChildren = item.children && item.children.length > 0 && excludes;
            html += `<div class="b3-list-item b3-list-item--narrow${index === 0 ? " b3-list-item--focus" : ""}" data-av-id="${item.avID}" data-block-id="${item.blockID}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl${excludes ? "" : " fn__none"}" style="height:auto;align-self: stretch;margin: 4px 0;">
        <svg class="b3-list-item__arrow">${hasChildren ? '<use xlink:href="#iconRight"></use>' : ""}</svg>
    </span>
    <span class="fn__space--small"></span>
    <div class="b3-list-item--two fn__flex-1">
        <div class="b3-list-item__first">
            <span class="b3-list-item__text">${escapeHtml(item.avName || window.siyuan.languages._kernel[267])}</span>
        </div>
        <div class="b3-list-item__meta b3-list-item__showall">${escapeGreat(item.hPath)}</div>
    </div>
    <svg aria-label="${window.siyuan.languages.thisDatabase}" style="margin: 0 0 0 4px" class="b3-list-item__hinticon ariaLabel${item.avID === avId ? "" : " fn__none"}"><use xlink:href="#iconInfo"></use></svg>
</div>`;
            if (hasChildren) {
                html += '<div class="fn__none">';
                item.children.forEach((subItem) => {
                    const viewDefaultName = getViewName(subItem.viewLayout);
                    html += `<div style="padding-left: 48px;" class="b3-list-item b3-list-item--narrow" data-av-id="${subItem.avID}" data-view-id="${subItem.viewID}">
<span class="b3-list-item__text">${escapeHtml(subItem.viewName)}</span> 
<span class="b3-list-item__meta">${viewDefaultName}</span>
</div>`;
                });
                html += "</div>";
            }
        });
        element.innerHTML = html;
        if (cb) {
            cb();
        }
    });
};

const setDatabase = (avId: string, element: HTMLElement, item: HTMLElement) => {
    element.dataset.avId = item.dataset.avId;
    element.dataset.blockId = item.dataset.blockId;
    element.querySelector(".b3-menu__accelerator").textContent = item.querySelector(".b3-list-item__hinticon").classList.contains("fn__none") ? item.querySelector(".b3-list-item__text").textContent : window.siyuan.languages.thisDatabase;
    const menuElement = hasClosestByClassName(element, "b3-menu__items");
    if (menuElement) {
        toggleUpdateRelationBtn(menuElement, avId, true);
    }
};

export const openSearchAV = (avId: string, target: HTMLElement, cb?: (element: HTMLElement) => void, excludes = true) => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter"${isMobile() ? "" : ' style="width: 50vw"'} >
    <input class="b3-text-field fn__flex-shrink"/>
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">
        <img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">
    </div>
</div>`,
        bind(element) {
            const listElement = element.querySelector(".b3-list");
            const inputElement = element.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                UDLRHint(listElement, event);
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    const listItemElement = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                    if (cb) {
                        cb(listItemElement);
                    } else {
                        setDatabase(avId, target, listItemElement);
                    }
                    window.siyuan.menus.menu.remove();
                }
            });
            inputElement.addEventListener("input", (event: InputEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                genSearchList(listElement, inputElement.value, avId, excludes);
            });
            inputElement.addEventListener("compositionend", () => {
                genSearchList(listElement, inputElement.value, avId, excludes);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                let clickTarget = event.target as HTMLElement;
                while (clickTarget && !clickTarget.classList.contains("b3-list")) {
                    if (clickTarget.classList.contains("b3-list-item__toggle")) {
                        if (clickTarget.firstElementChild.classList.contains("b3-list-item__arrow--open")) {
                            clickTarget.firstElementChild.classList.remove("b3-list-item__arrow--open");
                            clickTarget.parentElement.nextElementSibling.classList.add("fn__none");
                        } else {
                            clickTarget.firstElementChild.classList.add("b3-list-item__arrow--open");
                            clickTarget.parentElement.nextElementSibling.classList.remove("fn__none");
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (clickTarget.classList.contains("b3-list-item")) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (cb) {
                            cb(clickTarget);
                        } else {
                            setDatabase(avId, target, clickTarget);
                        }
                        window.siyuan.menus.menu.remove();
                        break;
                    }
                    clickTarget = clickTarget.parentElement;
                }
            });
            genSearchList(listElement, "", avId, excludes, () => {
                const rect = target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom,
                    h: rect.height,
                });
                element.querySelector("input").focus();
            });
        }
    });
    menu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
    const popoverElement = hasTopClosestByClassName(target, "block__popover", true);
    menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
};

export const updateRelation = (options: {
    protyle: IProtyle,
    avID: string,
    avElement: Element,
    colsData: IAVColumn[],
    blockElement: Element,
}) => {
    const inputElement = options.avElement.querySelector('input[data-type="colName"]') as HTMLInputElement;
    const goSearchAVElement = options.avElement.querySelector('.b3-menu__item[data-type="goSearchAV"]') as HTMLElement;
    const newAVId = goSearchAVElement.getAttribute("data-av-id");
    const colId = options.avElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let colData: IAVColumn;
    options.colsData.find(item => {
        if (item.id === colId) {
            if (!item.relation) {
                item.relation = {};
            }
            colData = item;
            return true;
        }
    });
    const colNewName = (options.avElement.querySelector('[data-type="name"]') as HTMLInputElement).value;
    transaction(options.protyle, [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        keyID: colId,
        id: newAVId || colData.relation.avID,
        backRelationKeyID: colData.relation.avID === newAVId ? (colData.relation.backKeyID || Lute.NewNodeID()) : Lute.NewNodeID(),
        isTwoWay: (options.avElement.querySelector(".b3-switch") as HTMLInputElement).checked,
        name: inputElement.value,
        format: colNewName
    }, {
        action: "doUpdateUpdated",
        id: options.blockElement.getAttribute("data-node-id"),
        data: dayjs().format("YYYYMMDDHHmmss"),
    }], [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        keyID: colId,
        id: colData.relation.avID || newAVId,
        backRelationKeyID: colData.relation.backKeyID,
        isTwoWay: colData.relation.isTwoWay,
        name: inputElement.dataset.oldValue,
        format: colData.name
    }]);
    options.avElement.remove();
    updateAttrViewCellAnimation(options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {name: colNewName});
    focusBlock(options.blockElement);
};

export const toggleUpdateRelationBtn = (menuItemsElement: HTMLElement, avId: string, resetData = false) => {
    const searchElement = menuItemsElement.querySelector('.b3-menu__item[data-type="goSearchAV"]') as HTMLElement;
    const switchItemElement = searchElement.nextElementSibling;
    const switchElement = switchItemElement.querySelector(".b3-switch") as HTMLInputElement;
    const inputItemElement = switchItemElement.nextElementSibling;
    const btnElement = inputItemElement.nextElementSibling;
    const oldValue = JSON.parse(searchElement.dataset.oldValue) as IAVColumnRelation;
    if (oldValue.avID) {
        const inputElement = inputItemElement.querySelector("input") as HTMLInputElement;
        if (resetData) {
            if (searchElement.dataset.avId !== oldValue.avID) {
                inputElement.value = "";
                switchElement.checked = false;
            } else {
                inputElement.value = inputElement.dataset.oldValue;
                switchElement.checked = oldValue.isTwoWay;
            }
        }
        if (switchElement.checked) {
            inputItemElement.classList.remove("fn__none");
        } else {
            inputItemElement.classList.add("fn__none");
        }
        if ((searchElement.dataset.avId && oldValue.avID !== searchElement.dataset.avId) || oldValue.isTwoWay !== switchElement.checked || inputElement.dataset.oldValue !== inputElement.value) {
            btnElement.classList.remove("fn__none");
        } else {
            btnElement.classList.add("fn__none");
        }
    } else if (searchElement.dataset.avId) {
        if (switchElement.checked) {
            inputItemElement.classList.remove("fn__none");
        } else {
            inputItemElement.classList.add("fn__none");
        }
        btnElement.classList.remove("fn__none");
    }
};

const updateCopyRelatedItems = (menuElement: Element) => {
    const inputElement = menuElement.querySelector(".b3-form__icona .b3-text-field") as HTMLInputElement;
    if (menuElement.querySelector(".b3-menu__icon.fn__grab")) {
        inputElement.nextElementSibling.classList.remove("fn__none");
        inputElement.style.paddingRight = "26px";
    } else {
        inputElement.nextElementSibling.classList.add("fn__none");
        inputElement.style.paddingRight = "";
    }
};

const genSelectItemHTML = (options: {
    type: "selected" | "empty" | "unselect",
    id?: string,
    isDetached?: boolean,
    text?: string,
    className?: string,
    rowId?: string,
    newName?: string
}) => {
    if (options.type === "selected") {
        return `<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
<span class="b3-menu__label fn__ellipsis ${options.isDetached ? "" : " popover__block"}" ${options.isDetached ? "" : 'style="color:var(--b3-protyle-inline-blockref-color)"'} data-id="${options.id}">${options.text}</span>
<svg class="b3-menu__action"><use xlink:href="#iconMin"></use></svg>`;
    }
    if (options.type === "empty") {
        if (options.newName) {
            return `<button class="b3-menu__item" data-type="setRelationCell">
    <span class="b3-menu__label fn__ellipsis">${window.siyuan.languages.newRowInRelation.replace("${x}", options.text).replace("${y}", options.newName)}</span>
</button>`;
        }
        return `<button class="b3-menu__item">
    <span class="b3-menu__label">${window.siyuan.languages.emptyContent}</span>
</button>`;
    }
    if (options.type == "unselect") {
        return `<button data-row-id="${options.rowId}" class="${options.className || "b3-menu__item ariaLabel"}" data-position="west" data-type="setRelationCell">
    <span class="b3-menu__label fn__ellipsis${options.isDetached ? "" : " popover__block"}" ${options.isDetached ? "" : 'style="color:var(--b3-protyle-inline-blockref-color)"'} data-id="${options.id}">${options.text}</span>
    <svg class="b3-menu__action"><use xlink:href="#iconAdd"></use></svg>
</button>`;
    }
};

const filterItem = (menuElement: Element, cellElement: HTMLElement, keyword: string) => {
    fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {
        id: menuElement.firstElementChild.getAttribute("data-av-id"),
        keyword,
    }, response => {
        const cells = response.data.rows.values as IAVCellValue[] || [];
        let html = "";
        let selectHTML = "";
        const hasIds: string[] = [];
        cellElement.querySelectorAll(".av__cell--relation").forEach((relationItem: HTMLElement) => {
            const item = relationItem.querySelector(".av__celltext") as HTMLElement;
            hasIds.push(relationItem.dataset.rowId);
            selectHTML += `<button data-row-id="${relationItem.dataset.rowId}" data-position="west" data-type="setRelationCell" 
class="b3-menu__item ariaLabel${item.textContent.indexOf(keyword) > -1 ? "" : " fn__none"}" 
draggable="true">${genSelectItemHTML({
                type: "selected",
                id: item.dataset.id,
                isDetached: !item.classList.contains("av__celltext--ref"),
                text: Lute.EscapeHTMLStr(item.textContent || window.siyuan.languages.untitled)
            })}</button>`;
        });
        cells.forEach((item) => {
            if (!hasIds.includes(item.blockID)) {
                html += genSelectItemHTML({
                    type: "unselect",
                    rowId: item.blockID,
                    id: item.block.id,
                    isDetached: item.isDetached,
                    text: Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)
                });
            }
        });
        const refElement = menuElement.querySelector(".popover__block");
        menuElement.querySelector(".b3-menu__items").innerHTML = `${selectHTML}
<button class="b3-menu__separator"></button>
${html}
${keyword ? genSelectItemHTML({
            type: "empty",
            newName: Lute.EscapeHTMLStr(keyword),
            text: `<span style="color: var(--b3-protyle-inline-blockref-color);" class="popover__block" data-id="${refElement.getAttribute("data-id")}">${refElement.textContent}</span>`,
        }) : (html ? "" : genSelectItemHTML({type: "empty"}))}`;
        menuElement.querySelector(".b3-menu__items .b3-menu__item:not(.fn__none)").classList.add("b3-menu__item--current");
        updateCopyRelatedItems(menuElement);
    });
};

export const bindRelationEvent = (options: {
    menuElement: HTMLElement,
    protyle: IProtyle,
    blockElement: Element,
    cellElements: HTMLElement[]
}) => {
    fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {
        id: options.menuElement.firstElementChild.getAttribute("data-av-id"),
        keyword: "",
    }, response => {
        const cells = response.data.rows.values as IAVCellValue[] || [];
        let html = "";
        let selectHTML = "";
        const hasIds: string[] = [];
        options.cellElements[0].querySelectorAll(".av__cell--relation").forEach((relationItem: HTMLElement) => {
            const item = relationItem.querySelector(".av__celltext") as HTMLElement;
            hasIds.push(relationItem.dataset.rowId);
            selectHTML += `<button data-row-id="${relationItem.dataset.rowId}" data-position="west" data-type="setRelationCell" class="b3-menu__item ariaLabel" 
draggable="true">${genSelectItemHTML({
                type: "selected",
                id: item.dataset.id,
                isDetached: !item.classList.contains("av__celltext--ref"),
                text: Lute.EscapeHTMLStr(item.textContent || window.siyuan.languages.untitled)
            })}</button>`;
        });
        cells.forEach((item) => {
            if (!hasIds.includes(item.blockID)) {
                html += genSelectItemHTML({
                    type: "unselect",
                    rowId: item.blockID,
                    id: item.block.id,
                    isDetached: item.isDetached,
                    text: Lute.EscapeHTMLStr(item.block.content || window.siyuan.languages.untitled)
                });
            }
        });
        options.menuElement.querySelector(".b3-menu__items").innerHTML = `${selectHTML}
<button class="b3-menu__separator"></button>
${html || genSelectItemHTML({type: "empty"})}`;
        const cellRect = options.cellElements[options.cellElements.length - 1].getBoundingClientRect();
        setPosition(options.menuElement, cellRect.left, cellRect.bottom, cellRect.height);
        options.menuElement.querySelector(".b3-menu__items .b3-menu__item:not(.fn__none)").classList.add("b3-menu__item--current");
        const inputElement = options.menuElement.querySelector("input");
        inputElement.focus();
        const databaseName = inputElement.parentElement.parentElement.querySelector(".popover__block");
        databaseName.innerHTML = Lute.EscapeHTMLStr(response.data.name);
        databaseName.setAttribute("data-id", response.data.blockIDs[0]);
        const listElement = options.menuElement.querySelector(".b3-menu__items");
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            upDownHint(listElement, event, "b3-menu__item--current");
            const currentElement = options.menuElement.querySelector(".b3-menu__item--current") as HTMLElement;
            if (event.key === "Enter" && currentElement && currentElement.getAttribute("data-type") === "setRelationCell") {
                setRelationCell(options.protyle, options.blockElement as HTMLElement, currentElement, options.cellElements);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        inputElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            filterItem(options.menuElement, options.cellElements[0], inputElement.value);
            event.stopPropagation();
        });
        inputElement.addEventListener("compositionend", (event) => {
            event.stopPropagation();
            filterItem(options.menuElement, options.cellElements[0], inputElement.value);
        });
        updateCopyRelatedItems(options.menuElement);
        options.menuElement.querySelector('[data-type="copyRelatedItems"]').addEventListener("click", () => {
            let copyText = "";
            const selectedElements = options.menuElement.querySelectorAll('.b3-menu__item[draggable="true"]');
            selectedElements.forEach((item: HTMLElement) => {
                if (selectedElements.length > 1) {
                    copyText += "- ";
                }
                const textElement = item.querySelector(".b3-menu__label") as HTMLElement;
                if (!textElement.dataset.id || textElement.dataset.id === "undefined") {
                    copyText += textElement.textContent + "\n";
                } else {
                    copyText += `((${textElement.dataset.id} "${textElement.textContent}"))\n`;
                }
            });
            if (copyText) {
                writeText(copyText.trimEnd());
                showMessage(window.siyuan.languages.copied);
            }
        });
    });
};

export const getRelationHTML = (data: IAV, cellElements?: HTMLElement[]) => {
    let colRelationData: IAVColumnRelation;
    getFieldsByData(data).find(item => {
        if (item.id === getColId(cellElements[0], data.viewType)) {
            colRelationData = item.relation;
            return true;
        }
    });
    if (colRelationData && colRelationData.avID) {
        return `<div data-av-id="${colRelationData.avID}" class="fn__flex-column">
<div class="b3-menu__item" data-type="nobg">
    <div class="b3-form__icona fn__flex-1" style="overflow: visible">
        <input class="b3-text-field fn__block" style="min-width: 190px"/>
        <svg class="b3-form__icona-icon ariaLabel fn__none" data-position="north" data-type="copyRelatedItems" aria-label="${window.siyuan.languages.copy} ${window.siyuan.languages.relatedItems}"><use xlink:href="#iconCopy"></use></svg>
    </div>
    <span class="fn__space"></span>
    <span style="color: var(--b3-protyle-inline-blockref-color);max-width: 200px" data-id="" class="popover__block fn__pointer fn__ellipsis"></span>
</div>
<div class="b3-menu__items">
    <img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">
</div>`;
    } else {
        return "";
    }
};

export const setRelationCell = async (protyle: IProtyle, nodeElement: HTMLElement, target: HTMLElement, cellElements: HTMLElement[]) => {
    const menuElement = hasClosestByClassName(target, "b3-menu");
    if (!menuElement) {
        return;
    }
    if (menuElement.querySelector(".dragover__bottom, .dragover__top")) {
        return;
    }

    if (!nodeElement.contains(cellElements[0])) {
        const viewType = nodeElement.getAttribute("data-av-type") as TAVView;
        const rowID = getFieldIdByCellElement(cellElements[0], viewType);
        if (viewType === "table") {
            cellElements[0] = (nodeElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${cellElements[0].dataset.colId}"]`) ||
                nodeElement.querySelector(`.fn__flex-1[data-col-id="${cellElements[0].dataset.colId}"]`)) as HTMLElement;
        } else {
            cellElements[0] = (nodeElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${cellElements[0].dataset.fieldId}"]`)) as HTMLElement;
        }
    }

    const newValue: IAVCellRelationValue = {blockIDs: [], contents: []};
    menuElement.querySelectorAll('[draggable="true"]').forEach(item => {
        const rowId = item.getAttribute("data-row-id");
        const blockPopElement = item.querySelector(".b3-menu__label");
        newValue.blockIDs.push(rowId);
        newValue.contents.push({
            type: "block",
            block: {
                id: blockPopElement.getAttribute("data-id"),
                content: blockPopElement.textContent
            },
            isDetached: !blockPopElement.classList.contains("popover__block")
        });
    });
    if (target.classList.contains("b3-menu__item")) {
        const rowId = target.getAttribute("data-row-id");
        const id = target.querySelector(".b3-menu__label").getAttribute("data-id");
        const separatorElement = menuElement.querySelector(".b3-menu__separator");
        const searchValue = menuElement.querySelector("input").value;
        if (target.getAttribute("draggable")) {
            if (!separatorElement.nextElementSibling.getAttribute("data-row-id") && !searchValue) {
                separatorElement.nextElementSibling.remove();
            }
            const removeIndex = newValue.blockIDs.indexOf(rowId);
            newValue.blockIDs.splice(removeIndex, 1);
            newValue.contents.splice(removeIndex, 1);
            separatorElement.after(target);
            target.outerHTML = genSelectItemHTML({
                type: "unselect",
                rowId,
                id,
                isDetached: !target.querySelector(".popover__block"),
                text: Lute.EscapeHTMLStr(target.querySelector(".b3-menu__label").textContent),
                className: target.className
            });
            updateCellsValue(protyle, nodeElement, newValue, cellElements);
        } else if (rowId) {
            newValue.blockIDs.push(rowId);
            newValue.contents.push({
                type: "block",
                block: {
                    id,
                    content: target.firstElementChild.textContent
                },
                isDetached: !target.firstElementChild.getAttribute("style")
            });
            separatorElement.before(target);
            target.outerHTML = `<button data-row-id="${rowId}" data-position="west" data-type="setRelationCell" class="${target.className}" 
draggable="true">${genSelectItemHTML({
                type: "selected",
                rowId,
                id,
                isDetached: !target.querySelector(".popover__block"),
                text: Lute.EscapeHTMLStr(target.querySelector(".b3-menu__label").textContent)
            })}</button>`;
            if (!separatorElement.nextElementSibling) {
                separatorElement.insertAdjacentHTML("afterend", genSelectItemHTML({type: "empty"}));
            }
            updateCellsValue(protyle, nodeElement, newValue, cellElements);
        } else {
            const blockID = target.querySelector(".popover__block").getAttribute("data-id");
            const content = target.querySelector("b").textContent;
            const rowId = Lute.NewNodeID();
            const bodyElement = hasClosestByClassName(cellElements[0], "av__body");
            newValue.blockIDs.push(rowId);
            newValue.contents.push({
                type: "block",
                block: {
                    content
                },
                isDetached: true
            });
            const updateOptions = await updateCellsValue(protyle, nodeElement, newValue, cellElements, null, null, true);
            const doOperations: IOperation[] = [{
                action: "insertAttrViewBlock",
                ignoreDefaultFill: true,
                avID: menuElement.firstElementChild.getAttribute("data-av-id"),
                srcs: [{
                    itemID: rowId,
                    id: Lute.NewNodeID(),
                    isDetached: true,
                    content
                }],
                blockID,
                groupID: bodyElement ? bodyElement.getAttribute("data-group-id") : "",
            }, {
                action: "doUpdateUpdated",
                id: blockID,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }];
            separatorElement.insertAdjacentHTML("beforebegin", `<button data-row-id="${rowId}" data-position="west" data-type="setRelationCell" 
class="${target.className} ariaLabel" draggable="true">${genSelectItemHTML({
                type: "selected",
                rowId,
                isDetached: true,
                text: Lute.EscapeHTMLStr(content)
            })}</button>`);
            transaction(protyle, doOperations.concat(updateOptions.doOperations));
        }
    }
    updateCopyRelatedItems(menuElement);
};
