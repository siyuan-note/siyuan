import {Menu} from "../../../plugin/Menu";
import {unicode2Emoji} from "../../../emoji";
import {transaction} from "../../wysiwyg/transaction";

export const openViewMenu = (element: HTMLElement) => {
    const menu = new Menu("av-view");
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        icon: "iconEdit",
        label: window.siyuan.languages.rename,
        click() {

        }
    })
    menu.addItem({
        icon: "iconSettings",
        label: window.siyuan.languages.config,
        click() {

        }
    })
    menu.addSeparator();
    menu.addItem({
        icon: "iconCopy",
        label: window.siyuan.languages.duplicate,
        click() {

        }
    })
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {

        }
    })
    const rect = element.getBoundingClientRect()
    menu.open({
        x: rect.left,
        y: rect.bottom
    })
}

export const bindViewEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
}) => {
    const inputElement = options.menuElement.querySelector('.b3-text-field[data-type="name"]') as HTMLInputElement
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
            }])
            inputElement.dataset.value = inputElement.value
        }
    })
}

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
<button class="b3-menu__item" data-type="goProperties">
    <svg class="b3-menu__icon"></svg>
    <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
    <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goFilters">
    <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
    <span class="b3-menu__accelerator">${data.filters.length}</span>
    <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="goSorts">
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
