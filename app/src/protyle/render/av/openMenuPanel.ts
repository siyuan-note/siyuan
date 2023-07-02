import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {addCol} from "./addCol";
import {getColIconByType} from "./col";

export const openMenuPanel = (protyle: IProtyle, blockElement: HTMLElement, type: "properties" | "config" = "config") => {
    let avMenuPanel = document.querySelector(".av__panel");
    if (avMenuPanel) {
        avMenuPanel.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    const avId = blockElement.getAttribute("data-av-id");
    fetchPost("/api/av/renderAttributeView", {id: avId}, (response) => {
        const data = response.data.av as IAV;
        const tabRect = blockElement.querySelector(".layout-tab-bar").getBoundingClientRect();
        let html;
        if (type === "config") {
            html = getConfigHTML(data, tabRect);
        } else if (type === "properties") {
            html = getPropertiesHTML(data, tabRect);
        }
        document.body.insertAdjacentHTML("beforeend", `<div class="av__panel">${html}</div>`);
        avMenuPanel = document.querySelector(".av__panel");
        avMenuPanel.addEventListener("click", (event) => {
            event.preventDefault();
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(avMenuPanel)) {
                const type = target.dataset.type;
                if (type === "close") {
                    avMenuPanel.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "goConfig") {
                    avMenuPanel.innerHTML = getConfigHTML(data, tabRect);
                    event.stopPropagation();
                    break;
                } else if (type === "goProperties") {
                    avMenuPanel.innerHTML = getPropertiesHTML(data, tabRect);
                    event.stopPropagation();
                    break;
                } else if (type === "newCol") {
                    avMenuPanel.remove();
                    const addMenu = addCol(protyle, blockElement);
                    addMenu.open({
                        x: tabRect.right,
                        y: tabRect.bottom,
                        h: tabRect.height,
                        isLeft: true
                    });
                    event.stopPropagation();
                    break;
                } else if (type === "showAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.columns.forEach((item: IAVColumn) => {
                        if (item.hidden) {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: false
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: true
                            });
                            item.hidden = false;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(protyle, doOperations, undoOperations);
                        avMenuPanel.innerHTML = getPropertiesHTML(data, tabRect);
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "hideAllCol") {
                    const doOperations: IOperation[] = [];
                    const undoOperations: IOperation[] = [];
                    data.columns.forEach((item: IAVColumn) => {
                        if (!item.hidden && item.type !== "block") {
                            doOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: true
                            });
                            undoOperations.push({
                                action: "setAttrViewColHidden",
                                id: item.id,
                                parentID: avId,
                                data: false
                            });
                            item.hidden = true;
                        }
                    });
                    if (doOperations.length > 0) {
                        transaction(protyle, doOperations, undoOperations);
                        avMenuPanel.innerHTML = getPropertiesHTML(data, tabRect);
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "hideCol") {
                    const colId = target.getAttribute("data-id");
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
                    data.columns.find((item: IAVColumn) => item.id === colId).hidden = true;
                    avMenuPanel.innerHTML = getPropertiesHTML(data, tabRect);
                    event.stopPropagation();
                    break;
                } else if (type === "showCol") {
                    const colId = target.getAttribute("data-id");
                    transaction(protyle, [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: false
                    }], [{
                        action: "setAttrViewColHidden",
                        id: colId,
                        parentID: avId,
                        data: true
                    }]);
                    data.columns.find((item: IAVColumn) => item.id === colId).hidden = false;
                    avMenuPanel.innerHTML = getPropertiesHTML(data, tabRect);
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
    });
};

const getConfigHTML = (data: IAV, tabRect: DOMRect) => {
    return `<div class="b3-dialog__scrim" data-type="close"></div>
 <div class="b3-menu" style="right:${window.innerWidth - tabRect.right}px;top:${tabRect.bottom}px">
    <button class="b3-menu__item" data-type="nobg">
        <span class="b3-menu__label">${window.siyuan.languages.config}</span>
        <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
    </button>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="goProperties">
        <svg class="b3-menu__icon"></svg>
        <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
        <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
        <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
    </button>
    <button class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
        <span class="b3-menu__accelerator">${data.filters.length}</span>
        <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
    </button>
    <button class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
        <span class="b3-menu__accelerator">${data.sorts.length}</span>
        <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
    </button>
    <button class="b3-menu__item">
        <svg class="b3-menu__icon"></svg>
        <span class="b3-menu__label">${window.siyuan.languages.pageCount}</span>
        <span class="b3-menu__accelerator">50</span>
        <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
    </button>
</div>`;
};

const getPropertiesHTML = (data: IAV, tabRect: DOMRect) => {
    let showHTML = "";
    let hideHTML = "";
    data.columns.forEach((item: IAVColumn) => {
        if (item.hidden) {
            hideHTML += `<button class="b3-menu__item">
    <svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
    <span class="b3-menu__label">${item.name}</span>
    <svg class="b3-menu__action" data-type="showCol" data-id="${item.id}"><use xlink:href="#iconEyeoff"></use></svg>
</button>`;
        } else {
            showHTML += `<button class="b3-menu__item">
    <svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>
    <span class="b3-menu__label">${item.name}</span>
    <svg class="b3-menu__action${item.type === "block" ? " fn__none" : ""}" data-type="hideCol" data-id="${item.id}"><use xlink:href="#iconEye"></use></svg>
</button>`;
        }
    });
    if (hideHTML) {
        hideHTML = `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">
        ${window.siyuan.languages.hideCol} 
    </span>
    <span class="block__icon" data-type="showAllCol">
        ${window.siyuan.languages.showAll}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEye"></use></svg>
    </span>
</button>
${hideHTML}`;
    }
    return `<div class="b3-dialog__scrim" data-type="close"></div>
 <div class="b3-menu" style="right:${window.innerWidth - tabRect.right}px;top:${tabRect.bottom}px">
    <button class="b3-menu__item" data-type="goConfig">
        <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.back}</span>
        <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
    </button>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="nobg">
        <span class="b3-menu__label">
            ${window.siyuan.languages.showCol} 
        </span>
        <span class="block__icon" data-type="hideAllCol">
            ${window.siyuan.languages.hideAll}
            <span class="fn__space"></span>
            <svg><use xlink:href="#iconEyeoff"></use></svg>
        </span>
    </button>
    ${showHTML}
    ${hideHTML}
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="newCol">
        <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.new}</span>
    </button>
</div>`;
};
