import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName} from "../../util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {genIconHTML} from "../util";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";

const updateCol = (protyle: IProtyle, data: IAV, colId: string, itemElement: HTMLElement) => {
    if (itemElement.classList.contains("b3-list--empty")) {
        return
    }
    const colData = data.view.columns.find((item) => {
        if (item.id === colId) {
            return true;
        }
    });
    transaction(protyle, [{
        action: "updateAttrViewColRollup",
        id: colId,
        avID: data.id,
        parentID: itemElement.dataset.colId,
        keyID: "",
        data: "",
    }], [{
        action: "updateAttrViewColRollup",
        // operation.AvID 汇总列所在 av
        // operation.ID 汇总列 ID
        // operation.ParentID 汇总列基于的关联列 ID
        // operation.KeyID 目标列 ID
        // operation.Data 计算方式
    }]);
};

const genSearchList = (element: Element, keyword: string, avId: string, cb?: () => void) => {
    fetchPost("/api/av/searchAttributeViewRelationKey", {
        avID: avId,
        keyword
    }, (response) => {
        let html = "";
        response.data.keys.forEach((item: IAVColumn, index: number) => {
            html += `<div class="b3-list-item b3-list-item--narrow${index === 0 ? " b3-list-item--focus" : ""}" data-col-id="${item.id}">
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
    colId: string
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
                    updateCol(options.protyle, options.data, options.colId, listElement.querySelector(".b3-list-item--focus"));
                    window.siyuan.menus.menu.remove();
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                genSearchList(listElement, inputElement.value, options.data.id);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const listItemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    updateCol(options.protyle, options.data, options.colId, listItemElement);
                    window.siyuan.menus.menu.remove();
                }
            });
            genSearchList(listElement, "", options.data.id, () => {
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

export const goSearchRollupTarget = (avId: string, target: HTMLElement) => {

};

export const goSearchRollupCalc = (avId: string, target: HTMLElement) => {

};
