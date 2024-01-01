import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName} from "../../util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {genIconHTML} from "../util";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {showMessage} from "../../../dialog/message";

const updateCol = (options: {
    target: HTMLElement,
    data: IAV,
    protyle: IProtyle,
    colId: string,
    isRelation: boolean,
}, itemElement: HTMLElement) => {
    if (itemElement.classList.contains("b3-list--empty")) {
        return
    }
    options.target.querySelector(".b3-menu__accelerator").textContent = itemElement.querySelector(".b3-list-item__text").textContent

    const colData = options.data.view.columns.find((item) => {
        if (item.id === options.colId) {
            if (!item.rollup) {
                item.rollup = {};
            }
            return true;
        }
    });
    const oldColValue = Object.assign({}, colData.rollup);
    if (options.isRelation) {
        colData.rollup.relationKeyID = itemElement.dataset.colId;
        options.target.nextElementSibling.setAttribute("data-av-id", itemElement.dataset.targetAvId);
    } else {
        colData.rollup.keyID = itemElement.dataset.colId;
        options.target.nextElementSibling.setAttribute("data-col-type", itemElement.dataset.colType);
    }
    transaction(options.protyle, [{
        action: "updateAttrViewColRollup",
        id: options.colId,
        avID: options.data.id,
        parentID: colData.rollup.relationKeyID,
        keyID: colData.rollup.keyID,
        data: {
            calc: colData.rollup.calc,
        },
    }], [{
        action: "updateAttrViewColRollup",
        id: options.colId,
        avID: options.data.id,
        parentID: oldColValue.relationKeyID,
        keyID: oldColValue.keyID,
        data: {
            calc: oldColValue.calc,
        }
    }]);
};

const genSearchList = (element: Element, keyword: string, avId: string, isRelation: boolean, cb?: () => void) => {
    if (!isRelation && !avId) {
        showMessage(window.siyuan.languages.selectRelation);
        return
    }
    fetchPost(isRelation ? "/api/av/searchAttributeViewRelationKey" : "/api/av/searchAttributeViewNonRelationKey", {
        avID: avId,
        keyword
    }, (response) => {
        let html = "";
        response.data.keys.forEach((item: IAVColumn, index: number) => {
            html += `<div class="b3-list-item b3-list-item--narrow${index === 0 ? " b3-list-item--focus" : ""}" data-col-id="${item.id}" ${isRelation ? `data-target-av-id="${item.relation.avID}"` : `data-col-type="${item.type}"`}>
        ${item.icon ? unicode2Emoji(item.icon, "b3-list-item__graphic", true) : `<svg class="b3-list-item__graphic"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`}
        ${genIconHTML()}
        <span class="b3-list-item__text">${escapeHtml(item.name || window.siyuan.languages.title)}</span>
</div>`;
        });
        element.innerHTML = html || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
        if (cb) {
            cb();
        }
    });
};

export const goSearchRollupCol = (options: {
    target: HTMLElement,
    data: IAV,
    protyle: IProtyle,
    colId: string,
    isRelation: boolean,
}) => {
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
                    updateCol(options, listElement.querySelector(".b3-list-item--focus") as HTMLElement);
                    window.siyuan.menus.menu.remove();
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                genSearchList(listElement, inputElement.value, options.isRelation ? options.data.id : options.target.dataset.avId, options.isRelation);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const listItemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    updateCol(options, listItemElement);
                    window.siyuan.menus.menu.remove();
                }
            });
            genSearchList(listElement, "", options.isRelation ? options.data.id : options.target.dataset.avId, options.isRelation, () => {
                const rect = options.target.getBoundingClientRect();
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
};
