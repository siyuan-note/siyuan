import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName} from "../../util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {updateCellsValue} from "./cell";

const genSearchList = (element: Element, keyword: string, avId: string, cb?: () => void) => {
    fetchPost("/api/av/searchAttributeView", {keyword}, (response) => {
        let html = "";
        response.data.results.forEach((item: {
            avID: string
            avName: string
            blockID: string
            hPath: string
        }, index: number) => {
            html += `<div class="b3-list-item b3-list-item--narrow${index === 0 ? " b3-list-item--focus" : ""}" data-av-id="${item.avID}" data-block-id="${item.blockID}">
    <div class="b3-list-item--two fn__flex-1">
        <div class="b3-list-item__first">
            <span class="b3-list-item__text">${escapeHtml(item.avName || window.siyuan.languages.title)}</span>
        </div>
        <div class="b3-list-item__meta b3-list-item__showall">${escapeHtml(item.hPath)}</div>
    </div>
    <svg aria-label="${window.siyuan.languages.thisDatabase}" style="margin: 0 0 0 4px" class="b3-list-item__hinticon ariaLabel${item.avID === avId ? "" : " fn__none"}"><use xlink:href="#iconInfo"></use></svg>
</div>`
        });
        element.innerHTML = html;
        if (cb) {
            cb()
        }
    })
}

const setDatabase = (avId: string, element: HTMLElement, item: HTMLElement) => {
    element.dataset.avId = item.dataset.avId;
    element.dataset.blockId = item.dataset.blockId;
    element.querySelector(".b3-menu__accelerator").textContent = item.querySelector(".b3-list-item__hinticon").classList.contains("fn__none") ? item.querySelector(".b3-list-item__text").textContent : window.siyuan.languages.thisDatabase
    const menuElement = hasClosestByClassName(element, "b3-menu__items")
    if (menuElement) {
        toggleUpdateRelationBtn(menuElement, avId);
    }
}

export const openSearchAV = (avId: string, target: HTMLElement) => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column" style = "min-width: 260px;max-width:420px;max-height: 50vh">
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
                const currentElement = upDownHint(listElement, event);
                if (currentElement) {
                    event.stopPropagation();
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    setDatabase(avId, target, listElement.querySelector(".b3-list-item--focus"));
                    window.siyuan.menus.menu.remove();
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                genSearchList(listElement, inputElement.value, avId);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const listItemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    setDatabase(avId, target, listItemElement)
                    window.siyuan.menus.menu.remove();
                }
            });
            genSearchList(listElement, "", avId, () => {
                const rect = target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom,
                    h: rect.height,
                })
                element.querySelector("input").focus();
            });
        }
    });
    menu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
}

export const updateRelation = (options: {
    protyle: IProtyle,
    avID: string,
    avElement: Element
}) => {
    transaction(options.protyle, [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        id: options.avElement.querySelector('.b3-menu__item[data-type="goSearchAV"]').getAttribute("data-av-id"),
        keyID: options.avElement.querySelector(".b3-menu__item").getAttribute("data-col-id"),   // 源 av 关联列 ID
        backRelationKeyID: Lute.NewNodeID(), // 双向关联的目标关联列 ID
        isTwoWay: (options.avElement.querySelector(".b3-switch") as HTMLInputElement).checked,
        name: (options.avElement.querySelector('input[data-type="colName"]') as HTMLInputElement).value,
    }], []);
    options.avElement.remove();
}

export const toggleUpdateRelationBtn = (menuItemsElement: HTMLElement, avId: string) => {
    const searchElement = menuItemsElement.querySelector('.b3-menu__item[data-type="goSearchAV"]') as HTMLElement
    const switchItemElement = searchElement.nextElementSibling;
    const switchElement = switchItemElement.querySelector(".b3-switch") as HTMLInputElement;
    const inputItemElement = switchItemElement.nextElementSibling;
    const btnElement = inputItemElement.nextElementSibling;
    const oldValue = JSON.parse(searchElement.dataset.oldValue);
    if (oldValue.avID) {
        if (searchElement.dataset.avId !== avId || (searchElement.dataset.avId === avId && oldValue.avID !== avId)) {
            switchItemElement.classList.remove("fn__none");
            if (switchElement.checked) {
                inputItemElement.classList.remove("fn__none");
            } else {
                inputItemElement.classList.add("fn__none");
            }
        } else {
            switchItemElement.classList.add("fn__none");
            inputItemElement.classList.add("fn__none");
        }
        const inputElement = inputItemElement.querySelector("input") as HTMLInputElement;
        if ((searchElement.dataset.avId && oldValue.avID !== searchElement.dataset.avId) || oldValue.isTwoWay !== switchElement.checked || inputElement.dataset.oldValue !== inputElement.value) {
            btnElement.classList.remove("fn__none");
        } else {
            btnElement.classList.add("fn__none");
        }
    } else if (searchElement.dataset.avId) {
        switchItemElement.classList.remove("fn__none");
        if (switchElement.checked) {
            inputItemElement.classList.remove("fn__none");
        } else {
            inputItemElement.classList.add("fn__none");
        }
        btnElement.classList.remove("fn__none");
    }
}

export const bindRelationEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement,
    cellElements: HTMLElement[]
}) => {
    const hasIds = options.menuElement.textContent.split(",");
    fetchPost("/api/av/renderAttributeView", {
        id: options.menuElement.firstElementChild.getAttribute("data-av-id"),
    }, response => {
        const avData = response.data as IAV;
        let cellIndex = 0
        avData.view.columns.find((item, index) => {
            if (item.type === "block") {
                cellIndex = index
                return;
            }
        })
        let html = ""
        let selectHTML = ""
        avData.view.rows.forEach((item) => {
            const text = item.cells[cellIndex].value.block.content || item.cells[cellIndex].value.block.id;
            if (hasIds.includes(item.id)) {
                selectHTML += `<button data-id="${item.id}" data-type="setRelationCell" data-type="setRelationCell" class="b3-menu__item" draggable="true">
    <svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
    <span class="b3-menu__label">${text}</span>
</button>`
            } else {
                html += `<button data-id="${item.id}" class="b3-menu__item" data-type="setRelationCell">
    <span class="b3-menu__label">${text}</span>
</button>`
            }
        })
        const empty = `<button class="b3-menu__item">
    <span class="b3-menu__label">${window.siyuan.languages.emptyContent}</span>
</button>`
        options.menuElement.innerHTML = `<div class="b3-menu__items">${selectHTML || empty}
<button class="b3-menu__separator"></button>
${html || empty}</div>`
    })
}

export const getRelationHTML = (data: IAV, cellElements?: HTMLElement[]) => {
    let colRelationData: IAVCellRelationValue
    data.view.columns.find(item => {
        if (item.id === cellElements[0].dataset.colId) {
            colRelationData = item.relation
            return true;
        }
    })
    if (colRelationData && colRelationData.avID) {
        let ids = ""
        cellElements[0].querySelectorAll("span").forEach((item) => {
            ids += `${item.getAttribute("data-id")},`;
        });
        return `<span data-av-id="${colRelationData.avID}">${ids}</span>`
    } else {
        return ""
    }
}

export const setRelationCell = (protyle: IProtyle, data: IAV, nodeElement: HTMLElement, target: HTMLElement) => {
    const menuElement = hasClosestByClassName(target, "b3-menu__items");
    if (!menuElement) {
        return
    }
    const ids: string[] = [];
    Array.from(menuElement.children).forEach((item) => {
        const id = item.getAttribute("data-id")
        if (item.getAttribute("draggable") && id) {
            ids.push(id);
        }
    })
    const empty = `<button class="b3-menu__item">
    <span class="b3-menu__label">${window.siyuan.languages.emptyContent}</span>
</button>`
    const targetId = target.getAttribute("data-id")
    const separatorElement = menuElement.querySelector(".b3-menu__separator");
    if (target.getAttribute("draggable")) {
        if (!separatorElement.nextElementSibling.getAttribute("data-id")) {
            separatorElement.nextElementSibling.remove();
        }
        ids.splice(ids.indexOf(targetId), 1);
        separatorElement.after(target);
        // TODO
        if (!separatorElement.previousElementSibling) {
            separatorElement.insertAdjacentHTML("beforebegin", empty);
        }
    } else {
        if (!separatorElement.previousElementSibling.getAttribute("data-id")) {
            separatorElement.previousElementSibling.remove();
        }
        ids.push(targetId);
        separatorElement.before(target);
        // TODO
        if (!separatorElement.nextElementSibling) {
            separatorElement.insertAdjacentHTML("afterend", empty);
        }
    }
    updateCellsValue(protyle, nodeElement, ids);
};
