import {hasClosestByAttribute, hasTopClosestByClassName} from "../util/hasClosest";
import {fetchPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "./highlightRender";
import {Constants} from "../../constants";
import {genBreadcrumb} from "../wysiwyg/renderBacklink";
import {avRender} from "./av/render";

export const blockRender = (protyle: IProtyle, element: Element, top?: number) => {
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
        // 需置于请求返回前，否则快速滚动会导致重复加载 https://ld246.com/article/1666857862494?r=88250
        item.setAttribute("data-render", "true");
        item.style.height = (item.clientHeight - 8) + "px"; // 减少抖动 https://ld246.com/article/1668669380171
        item.innerHTML = `<div class="protyle-icons${hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed") ? " fn__none" : ""}">
    <span aria-label="${window.siyuan.languages.refresh}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__reload protyle-icon--first"><svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg></span>
    <span aria-label="${window.siyuan.languages.update} SQL" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>${item.lastElementChild.outerHTML}`;
        const content = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        let breadcrumb: boolean | string = item.getAttribute("breadcrumb");
        if (breadcrumb) {
            breadcrumb = breadcrumb === "true";
        } else {
            breadcrumb = window.siyuan.config.editor.embedBlockBreadcrumb;
        }
        // https://github.com/siyuan-note/siyuan/issues/7575
        const sbElement = hasTopClosestByClassName(item, "sb");
        if (sbElement) {
            breadcrumb = false;
        }
        fetchPost("/api/search/searchEmbedBlock", {
            embedBlockID: item.getAttribute("data-node-id"),
            stmt: content,
            headingMode: item.getAttribute("custom-heading-mode") === "1" ? 1 : 0,
            excludeIDs: [item.getAttribute("data-node-id"), protyle.block.rootID],
            breadcrumb
        }, (response) => {
            const rotateElement = item.querySelector(".fn__rotate");
            if (rotateElement) {
                rotateElement.classList.remove("fn__rotate");
            }
            let html = "";
            response.data.blocks.forEach((blocksItem: { block: IBlock, blockPaths: IBreadcrumb[] }) => {
                let breadcrumbHTML = "";
                if (blocksItem.blockPaths.length !== 0) {
                    breadcrumbHTML = genBreadcrumb(blocksItem.blockPaths, true);
                }
                html += `<div class="protyle-wysiwyg__embed" data-id="${blocksItem.block.id}">${breadcrumbHTML}${blocksItem.block.content}</div>`;
            });
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
            avRender(item, protyle);
            if (top) {
                // 前进后退定位 https://ld246.com/article/1667652729995
                protyle.contentElement.scrollTop = top;
            }
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
            item.style.height = "";
        });
    });
};
