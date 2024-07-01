import {Menu} from "../../../plugin/Menu";
import {unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";
import {openMenuPanel} from "./openMenuPanel";
import {removeBlock} from "../../wysiwyg/remove";
import {getEditorRange} from "../../util/selection";
import {Constants} from "../../../constants";

export const openViewMenu = (options: { protyle: IProtyle, blockElement: HTMLElement, element: HTMLElement }) => {
    if (options.protyle.disabled) {
        return;
    }
    const menu = new Menu("av-view");
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        icon: "iconEdit",
        label: window.siyuan.languages.rename,
        click() {
            document.querySelector(".av__panel")?.remove();
            openMenuPanel({
                protyle: options.protyle,
                blockElement: options.blockElement,
                type: "config",
                cb: (avPanelElement) => {
                    (avPanelElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement).focus();
                }
            });
        }
    });
    menu.addItem({
        icon: "iconSettings",
        label: window.siyuan.languages.config,
        click() {
            document.querySelector(".av__panel")?.remove();
            openMenuPanel({
                protyle: options.protyle,
                blockElement: options.blockElement,
                type: "config"
            });
        }
    });
    menu.addSeparator();
    menu.addItem({
        icon: "iconCopy",
        label: window.siyuan.languages.duplicate,
        click() {
            document.querySelector(".av__panel")?.remove();
            const id = Lute.NewNodeID();
            transaction(options.protyle, [{
                action: "duplicateAttrViewView",
                avID: options.blockElement.dataset.avId,
                previousID: options.element.dataset.id,
                id,
                blockID: options.blockElement.dataset.nodeId
            }], [{
                action: "removeAttrViewView",
                avID: options.blockElement.dataset.avId,
                id,
                blockID: options.blockElement.dataset.nodeId
            }]);
            options.blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, id);
        }
    });
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            document.querySelector(".av__panel")?.remove();
            if (options.blockElement.querySelectorAll(".layout-tab-bar .item").length === 1) {
                removeBlock(options.protyle, options.blockElement, getEditorRange(options.blockElement), "remove");
            } else {
                transaction(options.protyle, [{
                    action: "removeAttrViewView",
                    avID: options.blockElement.dataset.avId,
                    id: options.element.dataset.id,
                    blockID: options.blockElement.dataset.nodeId
                }]);
            }
        }
    });
    const rect = options.element.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const bindViewEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}) => {
    const inputElement = options.menuElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement;
    inputElement.addEventListener("blur", () => {
        if (inputElement.value !== inputElement.dataset.value) {
            transaction(options.protyle, [{
                action: "setAttrViewViewName",
                avID: options.data.id,
                id: options.data.viewID,
                data: inputElement.value
            }], [{
                action: "setAttrViewViewName",
                avID: options.data.id,
                id: options.data.viewID,
                data: inputElement.dataset.value
            }]);
            inputElement.dataset.value = inputElement.value;
        }
    });
    inputElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            inputElement.blur();
            options.menuElement.parentElement.remove();
        }
    });
    inputElement.select();
    const toggleTitleElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-view-title"]') as HTMLInputElement;
    toggleTitleElement.addEventListener("change", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!toggleTitleElement.checked) {
            // hide
            transaction(options.protyle, [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: true
            }], [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: false
            }]);
            options.blockElement.querySelector(".av__title").classList.add("fn__none");
        } else {
            transaction(options.protyle, [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: false
            }], [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: true
            }]);
            options.blockElement.querySelector(".av__title").classList.remove("fn__none");
        }
    });
};

export const getViewHTML = (data: IAVTable) => {
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label ft__center">${window.siyuan.languages.config}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span style="padding: 5px;margin-right: 8px;width: 14px;font-size: 14px;" class="block__icon block__icon--show" data-icon="${data.icon}" data-type="update-view-icon">${data.icon ? unicode2Emoji(data.icon) : '<svg><use xlink:href="#iconTable"></use></svg>'}</span>
    <span class="b3-menu__label" style="padding: 4px;display: flex;"><input data-type="name" class="b3-text-field fn__block" type="text" value="${data.name}" data-value="${data.name}"></span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="go-properties">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
    <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
    <span class="b3-menu__accelerator">${data.filters.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goSorts">
    <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
    <span class="b3-menu__accelerator">${data.sorts.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-page-size" data-size="${data.pageSize}">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.pageCount}</span>
    <span class="b3-menu__accelerator">${data.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : data.pageSize}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <svg class="b3-menu__icon"></svg>
    <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${data.hideAttrViewName ? "" : "checked"}>
</label>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="duplicate-view">
    <svg class="b3-menu__icon">
        <use xlink:href="#iconCopy"></use>
    </svg>
    <span class="b3-menu__label">${window.siyuan.languages.duplicate}</span>
</button>
<button class="b3-menu__item" data-type="delete-view">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>
</div>`;
};

export const getSwitcherHTML = (views: IAVView[], viewId: string) => {
    let html = "";
    views.forEach((item) => {
        html += `<button draggable="true" class="b3-menu__item${item.id === viewId ? " b3-menu__item--current" : ""}" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex" data-type="av-view-switch">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : '<svg class="b3-menu__icon"><use xlink:href="#iconTable"></use></svg>'}
        ${item.name}
    </div>
    <svg class="b3-menu__action" data-type="av-view-edit"><use xlink:href="#iconEdit"></use></svg>
</button>`;
    });
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="av-add">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.newView}</span>
</button>
<button class="b3-menu__separator"></button>
${html}
</div>`;
};

export const addView = (protyle: IProtyle, blockElement: Element) => {
    const id = Lute.NewNodeID();
    const avID = blockElement.getAttribute("data-av-id");
    transaction(protyle, [{
        action: "addAttrViewView",
        avID,
        id,
        blockID: blockElement.getAttribute("data-node-id")
    }], [{
        action: "removeAttrViewView",
        avID,
        id,
        blockID: blockElement.getAttribute("data-node-id")
    }]);
    blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, id);
};
