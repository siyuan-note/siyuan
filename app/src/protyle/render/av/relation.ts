import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName, hasTopClosestByClassName} from "../../util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeGreat, escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {updateCellsValue} from "./cell";
import {updateAttrViewCellAnimation} from "./action";
import {focusBlock} from "../../util/selection";
import {setPosition} from "../../../util/setPosition";

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
        <div class="b3-list-item__meta b3-list-item__showall">${escapeGreat(item.hPath)}</div>
    </div>
    <svg aria-label="${window.siyuan.languages.thisDatabase}" style="margin: 0 0 0 4px" class="b3-list-item__hinticon ariaLabel${item.avID === avId ? "" : " fn__none"}"><use xlink:href="#iconInfo"></use></svg>
</div>`;
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

export const openSearchAV = (avId: string, target: HTMLElement, cb?: (element: HTMLElement) => void) => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter">
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
                genSearchList(listElement, inputElement.value, avId);
            });
            inputElement.addEventListener("compositionend", () => {
                genSearchList(listElement, inputElement.value, avId);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const listItemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    if (cb) {
                        cb(listItemElement);
                    } else {
                        setDatabase(avId, target, listItemElement);
                    }
                    window.siyuan.menus.menu.remove();
                }
            });
            genSearchList(listElement, "", avId, () => {
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
        backRelationKeyID: colData.relation.avID === newAVId ? colData.relation.backKeyID : Lute.NewNodeID(),
        isTwoWay: (options.avElement.querySelector(".b3-switch") as HTMLInputElement).checked,
        name: inputElement.value,
        format: colNewName
    }], [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        keyID: colId,
        id: colData.relation.avID,
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
    const oldValue = JSON.parse(searchElement.dataset.oldValue) as IAVCellRelationValue;
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
        if (searchElement.dataset.avId === avId && oldValue.avID === avId && oldValue.isTwoWay) {
            switchItemElement.classList.add("fn__none");
            inputItemElement.classList.add("fn__none");
        } else {
            switchItemElement.classList.remove("fn__none");
            if (switchElement.checked) {
                inputItemElement.classList.remove("fn__none");
            } else {
                inputItemElement.classList.add("fn__none");
            }
        }
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
};

const genSelectItemHTML = (type: "selected" | "empty" | "unselect", id?: string, isDetached?: boolean, text?: string) => {
    if (type === "selected") {
        return `<button data-id="${id}" data-type="setRelationCell" class="b3-menu__item" draggable="true">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <span class="b3-menu__label${isDetached ? "" : " popover__block"}" ${isDetached ? "" : 'style="color:var(--b3-protyle-inline-blockref-color)"'} data-id="${id}">${text}</span>
    <svg class="b3-menu__action"><use xlink:href="#iconMin"></use></svg>
</button>`;
    }
    if (type === "empty") {
        return `<button class="b3-menu__item">
    <span class="b3-menu__label">${window.siyuan.languages.emptyContent}</span>
</button>`;
    }
    if (type == "unselect") {
        return `<button data-id="${id}" class="b3-menu__item" data-type="setRelationCell">
    <span class="b3-menu__label${isDetached ? "" : " popover__block"}" ${isDetached ? "" : 'style="color:var(--b3-protyle-inline-blockref-color)"'} data-id="${id}">${text}</span>
    <svg class="b3-menu__action"><use xlink:href="#iconAdd"></use></svg>
</button>`;
    }
};

const filterItem = (listElement: Element, key: string) => {
    Array.from(listElement.children).forEach((item: HTMLElement) => {
        if (item.dataset.id) {
            if (item.textContent.includes(key)) {
                item.classList.remove("fn__none");
            } else {
                item.classList.add("fn__none");
            }
        }
    });
};

export const bindRelationEvent = (options: {
    menuElement: HTMLElement,
    protyle: IProtyle,
    blockElement: Element,
    cellElements: HTMLElement[]
}) => {
    const hasIds = options.menuElement.firstElementChild.getAttribute("data-cell-ids").split(",");
    fetchPost("/api/av/getAttributeViewPrimaryKeyValues", {
        id: options.menuElement.firstElementChild.getAttribute("data-av-id"),
    }, response => {
        const cells = response.data.rows.values as IAVCellValue[];
        let html = "";
        let selectHTML = "";
        hasIds.forEach(hasId => {
            if (hasId) {
                cells.find((item) => {
                    if (item.block.id === hasId) {
                        selectHTML += genSelectItemHTML("selected", item.block.id, item.isDetached, item.block.content || "Untitled");
                        return true;
                    }
                });
            }
        });
        cells.forEach((item) => {
            if (!hasIds.includes(item.block.id)) {
                html += genSelectItemHTML("unselect", item.block.id, item.isDetached, item.block.content || "Untitled");
            }
        });
        options.menuElement.innerHTML = `<div class="fn__flex-column">
<div class="b3-menu__item fn__flex-column" data-type="nobg">
    <div class="b3-menu__label">${response.data.name}</div>
    <input class="b3-text-field fn__flex-shrink"/>
</div>
<div class="fn__hr"></div>
<div class="b3-menu__items">
    ${selectHTML || genSelectItemHTML("empty")}
    <button class="b3-menu__separator"></button>
    ${html || genSelectItemHTML("empty")}
</div>`;
        const cellRect = options.cellElements[options.cellElements.length - 1].getBoundingClientRect();
        setPosition(options.menuElement, cellRect.left, cellRect.bottom, cellRect.height);
        options.menuElement.querySelector(".b3-menu__items .b3-menu__item").classList.add("b3-menu__item--current");
        const inputElement = options.menuElement.querySelector("input");
        inputElement.focus();
        const listElement = options.menuElement.querySelector(".b3-menu__items");
        inputElement.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            upDownHint(listElement, event, "b3-menu__item--current");
            const currentElement = options.menuElement.querySelector(".b3-menu__item--current") as HTMLElement;
            if (event.key === "Enter" && currentElement && currentElement.getAttribute("data-type") === "setRelationCell") {
                setRelationCell(options.protyle, options.blockElement as HTMLElement, currentElement, options.cellElements);
                event.preventDefault();
                event.stopPropagation();
            } else if (event.key === "Escape") {
                options.menuElement.parentElement.remove();
                event.preventDefault();
                event.stopPropagation();
            }
        });
        inputElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            filterItem(listElement, inputElement.value);
            event.stopPropagation();
        });
        inputElement.addEventListener("compositionend", (event) => {
            event.stopPropagation();
            filterItem(listElement, inputElement.value);
        });
    });
};

export const getRelationHTML = (data: IAV, cellElements?: HTMLElement[]) => {
    let colRelationData: IAVCellRelationValue;
    data.view.columns.find(item => {
        if (item.id === cellElements[0].dataset.colId) {
            colRelationData = item.relation;
            return true;
        }
    });
    if (colRelationData && colRelationData.avID) {
        let ids = "";
        cellElements[0].querySelectorAll("span").forEach((item) => {
            ids += `${item.getAttribute("data-id")},`;
        });
        return `<div data-av-id="${colRelationData.avID}" data-cell-ids="${ids}" class="fn__flex-column">
<div class="b3-menu__item fn__flex-column" data-type="nobg">
    <div class="b3-menu__label">&nbsp;</div>
    <input class="b3-text-field fn__flex-shrink"/>
</div>
<div class="fn__hr"></div>
<div class="b3-menu__items">
    <img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">
</div>`;
    } else {
        return "";
    }
};

export const setRelationCell = (protyle: IProtyle, nodeElement: HTMLElement, target: HTMLElement, cellElements: HTMLElement[]) => {
    const menuElement = hasClosestByClassName(target, "b3-menu__items");
    if (!menuElement) {
        return;
    }
    const newValue: {
        blockIDs: string[]
        contents?: string[]
    } = {
        blockIDs: [],
        contents: []
    };
    Array.from(menuElement.children).forEach((item) => {
        const id = item.getAttribute("data-id");
        if (item.getAttribute("draggable") && id) {
            newValue.blockIDs.push(id);
            newValue.contents.push(item.textContent.trim());
        }
    });
    if (target.classList.contains("b3-menu__item")) {
        const targetId = target.getAttribute("data-id");
        const separatorElement = menuElement.querySelector(".b3-menu__separator");
        if (target.getAttribute("draggable")) {
            if (!separatorElement.nextElementSibling.getAttribute("data-id")) {
                separatorElement.nextElementSibling.remove();
            }
            const removeIndex = newValue.blockIDs.indexOf(targetId);
            newValue.blockIDs.splice(removeIndex, 1);
            newValue.contents.splice(removeIndex, 1);
            separatorElement.after(target);
            target.outerHTML = genSelectItemHTML("unselect", targetId, !target.querySelector(".popover__block"), target.querySelector(".b3-menu__label").textContent);
            if (!separatorElement.previousElementSibling) {
                separatorElement.insertAdjacentHTML("beforebegin", genSelectItemHTML("empty"));
            }
        } else {
            if (!separatorElement.previousElementSibling.getAttribute("data-id")) {
                separatorElement.previousElementSibling.remove();
            }
            newValue.blockIDs.push(targetId);
            newValue.contents.push(target.textContent.trim());
            separatorElement.before(target);
            target.outerHTML = genSelectItemHTML("selected", targetId, !target.querySelector(".popover__block"), target.querySelector(".b3-menu__label").textContent);
            if (!separatorElement.nextElementSibling) {
                separatorElement.insertAdjacentHTML("afterend", genSelectItemHTML("empty"));
            }
        }
        menuElement.firstElementChild.classList.add("b3-menu__item--current");
    }
    updateCellsValue(protyle, nodeElement, newValue, cellElements);
};
