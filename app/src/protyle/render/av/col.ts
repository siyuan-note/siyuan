import {hasClosestBlock} from "../../util/hasClosest";
import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {getCellValue, setFilter} from "./filter";

export const getColIconByType = (type: TAVCol) => {
    switch (type) {
        case "text":
            return "iconAlignLeft";
        case "block":
            return "iconParagraph";
        case "number":
            return "iconNumber";
        case "select":
            return "iconListItem";
        case "mSelect":
            return "iconList";
        case "date":
            return "iconCalendar";
    }
};

export const updateHeader = (rowElement: HTMLElement) => {
    const blockElement = hasClosestBlock(rowElement);
    if (!blockElement) {
        return;
    }
    const selectCount = rowElement.parentElement.querySelectorAll(".av__row--select:not(.av__row--header)").length;
    const diffCount = rowElement.parentElement.childElementCount - 3 - selectCount;
    const headElement = rowElement.parentElement.firstElementChild;
    const headUseElement = headElement.querySelector("use");
    const counterElement = blockElement.querySelector(".av__counter");
    const avHeadElement = blockElement.querySelector(".av__header") as HTMLElement;
    if (diffCount === 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconCheck");
    } else if (diffCount === rowElement.parentElement.childElementCount - 3) {
        headElement.classList.remove("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconUncheck");
        counterElement.classList.add("fn__none");
        avHeadElement.style.position = "";
        return;
    } else if (diffCount > 0) {
        headElement.classList.add("av__row--select");
        headUseElement.setAttribute("xlink:href", "#iconIndeterminateCheck");
    }
    counterElement.classList.remove("fn__none");
    counterElement.innerHTML = `${selectCount} selected`;
    avHeadElement.style.position = "sticky";
};

const removeCol = (cellElement: HTMLElement) => {
    const blockElement = hasClosestBlock(cellElement);
    if (!blockElement) {
        return false;
    }
    const colId = cellElement.getAttribute("data-col-id");
    blockElement.querySelectorAll(".av__row").forEach((item) => {
        item.querySelector(`[data-col-id="${colId}"]`).remove();
    });
    cellElement.remove();
};

export const showColMenu = (protyle: IProtyle, blockElement: HTMLElement, cellElement: HTMLElement) => {
    const type = cellElement.getAttribute("data-dtype") as TAVCol;
    const colId = cellElement.getAttribute("data-col-id");
    const avId = blockElement.getAttribute("data-av-id");
    const menu = new Menu("av-header-cell", () => {
        const newValue = (window.siyuan.menus.menu.element.querySelector(".b3-text-field") as HTMLInputElement).value;
        if (newValue === cellElement.textContent.trim()) {
            return;
        }
        transaction(protyle, [{
            action: "updateAttrViewCol",
            id: colId,
            parentID: avId,
            name: newValue,
            type,
        }], [{
            action: "updateAttrViewCol",
            id: colId,
            parentID: avId,
            name: cellElement.textContent.trim(),
            type,
        }]);
    });
    menu.addItem({
        icon: getColIconByType(type),
        label: `<input style="margin: 4px 0" class="b3-text-field" type="text" value="${cellElement.innerText.trim()}">`,
    });
    if (type !== "block") {
        menu.addItem({
            icon: "iconEdit",
            label: window.siyuan.languages.edit,
            click() {

            }
        });
    }
    menu.addSeparator();
    menu.addItem({
        icon: "iconUp",
        label: window.siyuan.languages.asc,
        click() {
            fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
                transaction(protyle, [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: [{
                            column: colId,
                            order: "ASC"
                        }]
                    }
                }], [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: response.data.av.sorts
                    }
                }]);
            });
        }
    });
    menu.addItem({
        icon: "iconDown",
        label: window.siyuan.languages.desc,
        click() {
            fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
                transaction(protyle, [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: [{
                            column: colId,
                            order: "DESC"
                        }]
                    }
                }], [{
                    action: "setAttrView",
                    id: avId,
                    data: {
                        sorts: response.data.av.sorts
                    }
                }]);
            });
        }
    });
    menu.addItem({
        icon: "iconFilter",
        label: window.siyuan.languages.filter,
        click() {
            fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
                const avData = response.data.av as IAV;
                let filter: IAVFilter;
                avData.filters.find((item) => {
                    if (item.column === colId) {
                        filter = item;
                        return true;
                    }
                });
                if (!filter) {
                    filter = {
                        column: colId,
                        operator: "Contains",
                        value: getCellValue(type, "")
                    };
                    avData.filters.push(filter);
                    transaction(protyle, [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: [filter]
                        }
                    }], [{
                        action: "setAttrView",
                        id: avId,
                        data: {
                            filters: []
                        }
                    }]);
                }
                setFilter({
                    filter,
                    protyle,
                    data: avData,
                    target: cellElement,
                });
            });
        }
    });
    menu.addSeparator();
    if (type !== "block") {
        menu.addItem({
            icon: "iconEyeoff",
            label: window.siyuan.languages.hide,
            click() {
                transaction(protyle, [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    parentID: avId,
                    data: true
                }], [{
                    action: "setAttrViewColHidden",
                    id: colId,
                    parentID: avId,
                    data: false
                }]);
            }
        });
        menu.addItem({
            icon: "iconCopy",
            label: window.siyuan.languages.duplicate,
            click() {

            }
        });
        menu.addItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            click() {
                transaction(protyle, [{
                    action: "removeAttrViewCol",
                    id: colId,
                    parentID: avId,
                }], [{
                    action: "addAttrViewCol",
                    name: cellElement.textContent.trim(),
                    parentID: avId,
                    type: type,
                    id: colId
                }]);
                removeCol(cellElement);
            }
        });
        menu.addSeparator();
    }
    menu.addItem({
        label: `<div class="fn__flex" style="margin: 4px 0"><span>${window.siyuan.languages.wrap}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${cellElement.style.whiteSpace === "nowrap" ? "" : " checked"}></div>`,
        bind(element) {
            const inputElement = element.querySelector("input") as HTMLInputElement;
            inputElement.addEventListener("change", () => {
                transaction(protyle, [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    parentID: avId,
                    data: inputElement.checked
                }], [{
                    action: "setAttrViewColWrap",
                    id: colId,
                    parentID: avId,
                    data: !inputElement.checked
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
