import {Menu} from "../../../plugin/Menu";
import {unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";
import {openMenuPanel} from "./openMenuPanel";
import {focusBlock} from "../../util/selection";
import {upDownHint} from "../../../util/upDownHint";
import {escapeAriaLabel, escapeAttr, escapeHtml} from "../../../util/escape";
import {hasClosestByClassName} from "../../util/hasClosest";
import {Constants} from "../../../constants";

export const openViewMenu = (options: { protyle: IProtyle, blockElement: HTMLElement, element: HTMLElement }) => {
    if (options.protyle.disabled) {
        return;
    }
    const menu = new Menu(Constants.MENU_AV_VIEW);
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
};

export const getViewHTML = (data: IAV) => {
    const view = data.view;
    const fields = getFieldsByData(data);
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label ft__center">${window.siyuan.languages.config}</span>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <div class="fn__block">
        <div class="fn__flex">
            <span class="b3-menu__avemoji" data-type="update-view-icon">${view.icon ? unicode2Emoji(view.icon) : `<svg style="height: 14px;width: 14px"><use xlink:href="#${getViewIcon(data.viewType)}"></use></svg>`}</span>
            <div class="b3-form__icona fn__block">
                <input data-type="name" class="b3-text-field b3-form__icona-input" type="text" data-value="${escapeAttr(view.name)}">
                <svg data-position="north" class="b3-form__icona-icon ariaLabel" aria-label="${view.desc ? escapeAriaLabel(view.desc) : window.siyuan.languages.addDesc}"><use xlink:href="#iconInfo"></use></svg>
            </div>
        </div>
        <div class="fn__none">
            <div class="fn__hr"></div>
            <textarea placeholder="${window.siyuan.languages.addDesc}" rows="1" data-type="desc" class="b3-text-field fn__block" type="text" data-value="${escapeAttr(view.desc)}">${view.desc}</textarea>
        </div>
        <div class="fn__hr"></div>
    </div>
</button>
<button class="b3-menu__item" data-type="go-layout">
    <svg class="b3-menu__icon"><use xlink:href="#${getViewIcon(data.viewType)}"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.layout}</span>
    <span class="b3-menu__accelerator">${getViewName(data.viewType)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="go-properties">
    <svg class="b3-menu__icon"><use xlink:href="#iconList"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.fields}</span>
    <span class="b3-menu__accelerator">${fields.filter((item: IAVColumn) => !item.hidden).length}/${fields.length}</span>
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
<button class="b3-menu__item" data-type="goGroups">
    <svg class="b3-menu__icon"><use xlink:href="#iconGroups"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.group}</span>
    <span class="b3-menu__accelerator">${(data.view.group && data.view.group.field) ? fields.filter((item: IAVColumn) => item.id === data.view.group.field)[0].name : ""}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
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
                transaction(options.protyle, [{
                    action: "setAttrViewBlockView",
                    blockID: options.blockElement.getAttribute("data-node-id"),
                    id: currentElement.dataset.id,
                    avID: options.blockElement.getAttribute("data-av-id"),
                }], [{
                    action: "setAttrViewBlockView",
                    blockID: options.blockElement.getAttribute("data-node-id"),
                    id: options.blockElement.querySelector(".av__views .item--focus").getAttribute("data-id"),
                    avID: options.blockElement.getAttribute("data-av-id"),
                }]);
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
    <div class="b3-menu__label fn__flex" data-type="av-view-switch" data-av-type="${item.type}">
        ${item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getViewIcon(item.type)}"></use></svg>`}
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
    const viewElement = blockElement.querySelector(".av__views");
    const addMenu = new Menu(undefined, () => {
        viewElement.classList.remove("av__views--show");
    });
    addMenu.addItem({
        icon: "iconTable",
        label: window.siyuan.languages.table,
        click() {
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
        }
    });
    addMenu.addItem({
        icon: "iconBoard",
        label: window.siyuan.languages.kanban,
        click() {
            transaction(protyle, [{
                action: "addAttrViewView",
                avID,
                layout: "kanban",
                id,
                blockID: blockElement.getAttribute("data-node-id")
            }], [{
                action: "removeAttrViewView",
                layout: "kanban",
                avID,
                id,
                blockID: blockElement.getAttribute("data-node-id")
            }]);
        }
    });
    addMenu.addItem({
        icon: "iconGallery",
        label: window.siyuan.languages.gallery,
        click() {
            transaction(protyle, [{
                action: "addAttrViewView",
                avID,
                layout: "gallery",
                id,
                blockID: blockElement.getAttribute("data-node-id")
            }], [{
                action: "removeAttrViewView",
                layout: "gallery",
                avID,
                id,
                blockID: blockElement.getAttribute("data-node-id")
            }]);
        }
    });
    viewElement.classList.add("av__views--show");
    const addRect = viewElement.querySelector('.block__icon[data-type="av-add"]')?.getBoundingClientRect();
    addMenu.open({
        x: addRect.left,
        y: addRect.bottom + 8
    });
};

export const getViewIcon = (type: string) => {
    switch (type) {
        case "table":
            return "iconTable";
        case "gallery":
            return "iconGallery";
        case "kanban":
            return "iconBoard";
    }
};

export const getViewName = (type: string) => {
    switch (type) {
        case "table":
            return window.siyuan.languages.table;
        case "gallery":
            return window.siyuan.languages.gallery;
        case "kanban":
            return window.siyuan.languages.kanban;
    }
};

export const getFieldsByData = (data: IAV) => {
    return data.viewType === "table" ? (data.view as IAVTable).columns : (data.view as IAVGallery).fields;
};

export const dragoverTab = (event: DragEvent) => {
    const viewTabElement = window.siyuan.dragElement.parentElement;
    if (viewTabElement.scrollWidth > viewTabElement.clientWidth) {
        const viewTabRect = viewTabElement.getBoundingClientRect();
        if (event.clientX < viewTabRect.left) {
            viewTabElement.scroll({
                left: viewTabElement.scrollLeft - Constants.SIZE_SCROLL_STEP,
                behavior: "smooth"
            });
        } else if (event.clientX > viewTabRect.right) {
            viewTabElement.scroll({
                left: viewTabElement.scrollLeft + Constants.SIZE_SCROLL_STEP,
                behavior: "smooth"
            });
        }
    }
    const target = hasClosestByClassName(document.elementFromPoint(event.clientX, window.siyuan.dragElement.getBoundingClientRect().top + 10), "item");
    if (!target) {
        return;
    }
    if (viewTabElement !== window.siyuan.dragElement.parentElement || (target === window.siyuan.dragElement)) {
        return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.left + targetRect.width / 2 < event.clientX) {
        if (target.nextElementSibling && target.nextElementSibling === window.siyuan.dragElement) {
            return;
        }
        target.after(window.siyuan.dragElement);
    } else {
        if (target.previousElementSibling && target.previousElementSibling === window.siyuan.dragElement) {
            return;
        }
        target.before(window.siyuan.dragElement);
    }
};
