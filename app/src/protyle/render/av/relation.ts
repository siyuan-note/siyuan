import {Menu} from "../../../plugin/Menu";
import {hasClosestByClassName} from "../../util/hasClosest";
import {upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeHtml} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";

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

const setDatabase = (element: HTMLElement, item: HTMLElement) => {
    element.dataset.avId = item.dataset.avId;
    element.dataset.blockId = item.dataset.blockId;
    element.querySelector(".b3-menu__accelerator").textContent = item.querySelector(".b3-list-item__hinticon").classList.contains("fn__none") ? item.querySelector(".b3-list-item__text").textContent : window.siyuan.languages.thisDatabase
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
                    setDatabase(target, listElement.querySelector(".b3-list-item--focus"));
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
                    setDatabase(target, listItemElement)
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

export const toggleUpdateRelationBtn = () => {

}
