import {Menu} from "../../../plugin/Menu";
import {getColIconByType} from "./col";
import {transaction} from "../../wysiwyg/transaction";
import {setPosition} from "../../../util/setPosition";

export const addSort = (options: {
    data: IAV,
    rect: DOMRect,
    menuElement: HTMLElement,
    tabRect: DOMRect,
    avId: string,
    protyle: IProtyle
}) => {
    const menu = new Menu("av-add-sort");
    options.data.view.columns.forEach((column) => {
        let hasSort = false;
        options.data.view.sorts.find((sort) => {
            if (sort.column === column.id) {
                hasSort = true;
                return true;
            }
        });
        if (!hasSort) {
            menu.addItem({
                label: column.name,
                icon: getColIconByType(column.type),
                click: () => {
                    const oldSorts = Object.assign([], options.data.view.sorts);
                    options.data.view.sorts.push({
                        column: column.id,
                        order: "ASC",
                    });
                    transaction(options.protyle, [{
                        action: "setAttrViewSorts",
                        avID: options.data.id,
                        data: options.data.view.sorts
                    }], [{
                        action: "setAttrViewSorts",
                        avID: options.data.id,
                        data: oldSorts
                    }]);
                    options.menuElement.innerHTML = getSortsHTML(options.data.view.columns, options.data.view.sorts);
                    bindSortsEvent(options.protyle, options.menuElement, options.data);
                    setPosition(options.menuElement, options.tabRect.right - options.menuElement.clientWidth, options.tabRect.bottom, options.tabRect.height);
                }
            });
        }
    });
    menu.open({
        x: options.rect.left,
        y: options.rect.bottom,
        h: options.rect.height,
    });
};

export const bindSortsEvent = (protyle: IProtyle, menuElement: HTMLElement, data: IAV) => {
    menuElement.querySelectorAll("select").forEach((item: HTMLSelectElement) => {
        item.addEventListener("change", () => {
            const colId = item.parentElement.getAttribute("data-id");
            const oldSort = JSON.parse(JSON.stringify(data.view.sorts));
            if (item.previousElementSibling.classList.contains("b3-menu__icon")) {
                data.view.sorts.find((sort: IAVSort) => {
                    if (sort.column === colId) {
                        sort.column = item.value;
                        item.parentElement.setAttribute("data-id", item.value);
                        return true;
                    }
                });
            } else {
                data.view.sorts.find((sort: IAVSort) => sort.column === colId).order = item.value as "ASC" | "DESC";
            }
            transaction(protyle, [{
                action: "setAttrViewSorts",
                avID: data.id,
                data: data.view.sorts
            }], [{
                action: "setAttrViewSorts",
                avID: data.id,
                data: oldSort
            }]);
        });
    });
};

export const getSortsHTML = (columns: IAVColumn[], sorts: IAVSort[]) => {
    let html = "";
    const genSortItem = (id: string) => {
        let sortHTML = "";
        columns.forEach((item) => {
            sortHTML += `<option value="${item.id}" ${item.id === id ? "selected" : ""}>${item.name}</option>`;
        });
        return sortHTML;
    };
    sorts.forEach((item: IAVSort) => {
        html += `<button draggable="true" class="b3-menu__item" data-id="${item.column}">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <select class="b3-select" style="margin: 4px 0">
        ${genSortItem(item.column)}
    </select>
    <span class="fn__space"></span>
    <select class="b3-select" style="margin: 4px 0">
        <option value="ASC" ${item.order === "ASC" ? "selected" : ""}>${window.siyuan.languages.asc}</option>
        <option value="DESC" ${item.order === "DESC" ? "selected" : ""}>${window.siyuan.languages.desc}</option>
    </select>
    <svg class="b3-menu__action" data-type="removeSort"><use xlink:href="#iconTrashcan"></use></svg>
</button>`;
    });
    return `<div class="b3-menu__items">
<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="goConfig">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
    <span class="b3-menu__label ft__center">${window.siyuan.languages.sort}</span>
    <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
</button>
<button class="b3-menu__separator"></button>
${html}
<button class="b3-menu__item${sorts.length === columns.length ? " fn__none" : ""}" data-type="addSort">
    <svg class="b3-menu__icon"><use xlink:href="#iconAdd"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.new}</span>
</button>
<button class="b3-menu__item${html ? "" : " fn__none"}" data-type="removeSorts">
    <svg class="b3-menu__icon"><use xlink:href="#iconTrashcan"></use></svg>
    <span class="b3-menu__label">${window.siyuan.languages.delete}</span>
</button>
</div>`;
};
