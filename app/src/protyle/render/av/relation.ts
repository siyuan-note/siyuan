import {Menu} from "../../../plugin/Menu";
import {isMobile} from "../../../util/functions";
import {hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {renderAssetsPreview} from "../../../asset/renderAssets";
import {upDownHint} from "../../../util/upDownHint";
import {hintRenderAssets} from "../../hint/extend";
import {focusByRange} from "../../util/selection";
import {fetchPost} from "../../../util/fetch";

const genSearchList = (element: HTMLElement, keyword: string) => {
    fetchPost("/api/av/searchAttributeView", {keyword}, (response) => {
        let html = ""
        response.data.forEach((item) => {
            html += `<div class="b3-list-item" data-value="${item.url}">`
        });
        element.lastElementChild.innerHTML = html;
    })
}

export const openSearchAV = () => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `<div class="fn__flex-column" style = "min-width: 260px;max-width:420px;max-height: 50vh">
    <input class="b3-text-field fn__flex-1"/>
    <div class="b3-list fn__flex-1 b3-list--background" style="position: relative">
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
                const isEmpty = element.querySelector(".b3-list--empty");
                if (!isEmpty) {
                    const currentElement = upDownHint(listElement, event);
                    if (currentElement) {
                        event.stopPropagation();
                    }
                }

                if (event.key === "Enter") {
                    if (!isEmpty) {
                        const currentURL = element.querySelector(".b3-list-item--focus").getAttribute("data-value");

                    } else {
                        window.siyuan.menus.menu.remove();
                        // focusByRange(protyle.toolbar.range);
                    }
                    // 空行处插入 mp3 会多一个空的 mp3 块
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                genSearchList(element, inputElement.value);
            });
            element.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const previousElement = hasClosestByAttribute(target, "data-type", "previous");
                if (previousElement) {
                    inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp"}));
                    event.stopPropagation();
                    return;
                }
                const nextElement = hasClosestByAttribute(target, "data-type", "next");
                if (nextElement) {
                    inputElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
                    event.stopPropagation();
                    return;
                }
                const listItemElement = hasClosestByClassName(target, "b3-list-item");
                if (listItemElement) {
                    event.stopPropagation();
                    const currentURL = listItemElement.getAttribute("data-value");
                    //  hintRenderAssets(currentURL, protyle);
                    window.siyuan.menus.menu.remove();
                }
            });
            genSearchList(element, "");
        }
    });
}
