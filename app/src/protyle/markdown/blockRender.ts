import {hasClosestByAttribute} from "../util/hasClosest";
import {fetchPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "./highlightRender";
import {Constants} from "../../constants";

export const blockRender = (protyle: IProtyle, element: Element) => {
    let blockElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeBlockQueryEmbed") {
        // 编辑器内代码块编辑渲染
        blockElements = [element];
    } else {
        blockElements = Array.from(element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]'));
    }
    if (blockElements.length === 0) {
        return;
    }
    blockElements.forEach((item: HTMLElement) => {
        if (item.getAttribute("data-render") === "true") {
            return;
        }
        item.innerHTML = `<div class="protyle-icons${hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") ? " fn__none" : ""}">
    <span class="protyle-icon protyle-action__reload protyle-icon--first"><svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg></span>
    <span class="protyle-icon protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>${item.lastElementChild.outerHTML}`;
        const content = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        fetchPost("/api/search/searchEmbedBlock", {
            stmt: content,
            headingMode: item.getAttribute("custom-heading-mode") === "1" ? 1 : 0,
            excludeIDs: [item.getAttribute("data-node-id"), protyle.block.rootID]
        }, (response) => {
            const rotateElement = item.querySelector(".fn__rotate");
            if (rotateElement) {
                rotateElement.classList.remove("fn__rotate");
            }
            let html = "";
            response.data.blocks.forEach((block: IBlock) => {
                html += `<div class="protyle-wysiwyg__embed" data-id="${block.id}">${block.content}</div>`;
            });
            item.setAttribute("data-render", "true");
            if (response.data.blocks.length > 0) {
                item.lastElementChild.insertAdjacentHTML("beforebegin", html +
                    // 辅助上下移动时进行选中
                    `<div style="position: absolute;">${Constants.ZWSP}</div>`);
            } else {
                item.lastElementChild.insertAdjacentHTML("beforebegin", `<div class="ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>
<div style="position: absolute;">${Constants.ZWSP}</div>`);
            }

            processRender(item);
            highlightRender(item);
            let maxDeep = 0;
            let deepEmbedElement: false | HTMLElement = item;
            while (maxDeep < 4 && deepEmbedElement) {
                deepEmbedElement = hasClosestByAttribute(deepEmbedElement.parentElement, "data-type", "NodeBlockQueryEmbed");
                maxDeep++;
            }
            if (maxDeep < 4) {
                item.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach(embedElement => {
                    blockRender(protyle, embedElement);
                });
            }
        });
    });
};
