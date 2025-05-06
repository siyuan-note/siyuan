import {Menu} from "../../../plugin/Menu";
import {unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";
import {openMenuPanel} from "./openMenuPanel";
import {focusBlock} from "../../util/selection";
import {Constants} from "../../../constants";
import {upDownHint} from "../../../util/upDownHint";
import {avRender} from "./render";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";

export const openViewMenu = (options: { protyle: IProtyle, blockElement: HTMLElement, element: HTMLElement }) => {
    if (options.protyle.disabled) {
        return;
    }
    const menu = new Menu("av-view");
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        id: "rename",
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
        id: "config",
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
        id: "duplicate",
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
    if (options.blockElement.querySelectorAll(".layout-tab-bar .item").length > 1) {
        menu.addItem({
            id: "delete",
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            click() {
                document.querySelector(".av__panel")?.remove();
                transaction(options.protyle, [{
                    action: "removeAttrViewView",
                    avID: options.blockElement.dataset.avId,
                    id: options.element.dataset.id,
                    blockID: options.blockElement.dataset.nodeId
                }]);
            }
        });
    }
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
    inputElement.value = inputElement.dataset.value;
    const descElement = options.menuElement.querySelector('.b3-text-field[data-type="desc"]') as HTMLTextAreaElement;
    inputElement.nextElementSibling.addEventListener("click", () => {
        const descPanelElement = descElement.parentElement;
        descPanelElement.classList.toggle("fn__none");
        if (!descPanelElement.classList.contains("fn__none")) {
            descElement.focus();
        }
    });
    descElement.addEventListener("blur", () => {
        if (descElement.value !== descElement.dataset.value) {
            transaction(options.protyle, [{
                action: "setAttrViewViewDesc",
                avID: options.data.id,
                id: options.data.viewID,
                data: descElement.value
            }], [{
                action: "setAttrViewViewDesc",
                avID: options.data.id,
                id: options.data.viewID,
                data: descElement.dataset.value
            }]);
            descElement.dataset.value = descElement.value;
        }
    });
    descElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            descElement.blur();
            options.menuElement.parentElement.remove();
        }
    });
    descElement.addEventListener("input", () => {
        inputElement.nextElementSibling.setAttribute("aria-label", descElement.value ? escapeHtml(descElement.value) : window.siyuan.languages.addDesc);
    });
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

export const getViewHTML = (data: IAV) => {
    const view = data.view;
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label ft__center">${window.siyuan.languages.config}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <div class="fn__block">
        <div class="fn__flex">
            <span class="b3-menu__avemoji" data-type="update-view-icon">${view.icon ? unicode2Emoji(view.icon) : '<svg style="height: 14px;width: 14px"><use xlink:href="#iconTable"></use></svg>'}</span>
            <div class="b3-form__icona fn__block">
                <input data-type="name" class="b3-text-field b3-form__icona-input" type="text" data-value="${escapeAttr(view.name)}">
                <svg data-position="north" class="b3-form__icona-icon ariaLabel" aria-label="${view.desc ? escapeAriaLabel(view.desc) : window.siyuan.languages.addDesc}"><use xlink:href="#iconInfo"></use></svg>
            </div>
        </div>
        <div class="fn__none">
            <div class="fn__hr"></div>
            <textarea placeholder="${window.siyuan.languages.addDesc}" rows="1" data-type="desc" class="b3-text-field fn__block" type="text" data-value="${escapeAttr(view.desc)}">${view.desc}</textarea>
        </div>
    </div>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="go-properties">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.fields}</span>
    <span class="b3-menu__accelerator">${view.columns.filter((item: IAVColumn) => !item.hidden).length}/${view.columns.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
    <span class="b3-menu__accelerator">${view.filters.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goSorts">
    <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
    <span class="b3-menu__accelerator">${view.sorts.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-page-size" data-size="${view.pageSize}">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.entryNum}</span>
    <span class="b3-menu__accelerator">${view.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : view.pageSize}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <svg class="b3-menu__icon"></svg>
    <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${view.hideAttrViewName ? "" : "checked"}>
</label>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="duplicate-view">
    <svg class="b3-menu__icon">
        <use xlink:href="#iconCopy"></use>
    </svg>
    <span class="b3-menu__label">${window.siyuan.languages.duplicate}</span>
</button>
<button class="b3-menu__item${data.views.length > 1 ? "" : " fn__none"}" data-type="delete-view">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>
</div>`;
};

export const bindSwitcherEvent = (options: { protyle: IProtyle, menuElement: Element, blockElement: Element }) => {
    const inputElement = options.menuElement.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.focus();
    inputElement.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        upDownHint(options.menuElement.querySelector(".fn__flex-1"), event, "b3-menu__item--current");
        if (event.key === "Enter") {
            const currentElement = options.menuElement.querySelector(".b3-menu__item--current") as HTMLElement;
            if (currentElement) {
                options.blockElement.removeAttribute("data-render");
                avRender(options.blockElement, options.protyle, undefined, currentElement.dataset.id);
                options.menuElement.remove();
                focusBlock(options.blockElement);
            }
        } else if (event.key === "Escape") {
            options.menuElement.remove();
            focusBlock(options.blockElement);
        }
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        filterSwitcher(options.menuElement);
    });
    inputElement.addEventListener("compositionend", () => {
        filterSwitcher(options.menuElement);
    });
};

const filterSwitcher = (menuElement: Element) => {
    const inputElement = menuElement.querySelector(".b3-text-field") as HTMLInputElement;
    const key = inputElement.value;
    menuElement.querySelectorAll('.b3-menu__item[draggable="true"]').forEach(item => {
        if (!key ||
            (key.toLowerCase().indexOf(item.textContent.trim().toLowerCase()) > -1 ||
                item.textContent.trim().toLowerCase().indexOf(key.toLowerCase()) > -1)) {
            item.classList.remove("fn__none");
        } else {
            item.classList.add("fn__none");
            item.classList.remove("b3-menu__item--current");
        }
    });
    if (!menuElement.querySelector(".b3-menu__item--current")) {
        menuElement.querySelector(".fn__flex-1 .b3-menu__item:not(.fn__none)")?.classList.add("b3-menu__item--current");
    }
};

export const getSwitcherHTML = (views: IAVView[], viewId: string) => {
    let html = "";
    views.forEach((item) => {
        html += `<button draggable="true" class="b3-menu__item${item.id === viewId ? " b3-menu__item--current" : ""}" data-id="${item.id}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <div class="b3-menu__label fn__flex" data-type="av-view-switch">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : '<svg class="b3-menu__icon"><use xlink:href="#iconTable"></use></svg>'}
        <span class="fn__ellipsis">${item.name}</span>
    </div>
    <svg class="b3-menu__action" data-type="av-view-edit"><use xlink:href="#iconEdit"></use></svg>
</button>`;
    });
    return `<div class="b3-menu__items fn__flex-column">
<button class="b3-menu__item" data-type="av-add">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.newView}</span>
</button>
<button class="b3-menu__separator"></button>
<div class="b3-menu__item fn__flex-shrink" data-type="nobg">
    <input class="b3-text-field fn__block" type="text" style="margin: 4px 0" placeholder="${window.siyuan.languages.search}">
</div>
<div class="fn__flex-1" style="overflow: auto">
    ${html}
</div>
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
