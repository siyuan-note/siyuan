import {hasClosestByAttribute} from "../util/hasClosest";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "./highlightRender";
import {genBreadcrumb, improveBreadcrumbAppearance} from "../wysiwyg/renderBacklink";
import {avRender} from "./av/render";
import {genRenderFrame} from "./util";

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
        genRenderFrame(item);
        if (item.childElementCount > 3) {
            item.style.height = (item.clientHeight - 4) + "px"; // 减少抖动 https://ld246.com/article/1668669380171
            for (let i = 1; i < item.children.length - 1; i++) {
                if (!item.children[i].classList.contains("protyle-cursor")) {
                    item.children[i].remove();
                    i--;
                }
            }
        }
        const content = Lute.UnEscapeHTMLStr(item.getAttribute("data-content"));
        let breadcrumb: boolean | string = item.getAttribute("breadcrumb");
        if (breadcrumb) {
            breadcrumb = breadcrumb === "true";
        } else {
            breadcrumb = window.siyuan.config.editor.embedBlockBreadcrumb;
        }

        if (content.startsWith("//!js")) {
            try {
                const includeIDs = new Function(
                    "fetchSyncPost",
                    "item",
                    "protyle",
                    "top",
                    content)(fetchSyncPost, item, protyle, top);
                if (includeIDs instanceof Promise) {
                    includeIDs.then((promiseIds) => {
                        if (Array.isArray(promiseIds)) {
                            fetchPost("/api/search/getEmbedBlock", {
                                embedBlockID: item.getAttribute("data-node-id"),
                                includeIDs: promiseIds,
                                headingMode: ["0", "1", "2"].includes(item.getAttribute("custom-heading-mode")) ? parseInt(item.getAttribute("custom-heading-mode")) : window.siyuan.config.editor.headingEmbedMode,
                                breadcrumb
                            }, (response) => {
                                renderEmbed(response.data.blocks || [], protyle, item, top);
                            });
                        } else {
                            return;
                        }
                    }).catch((e) => {
                        renderEmbed([], protyle, item, top, e);
                    });
                } else if (Array.isArray(includeIDs)) {
                    fetchPost("/api/search/getEmbedBlock", {
                        embedBlockID: item.getAttribute("data-node-id"),
                        includeIDs,
                        headingMode: ["0", "1", "2"].includes(item.getAttribute("custom-heading-mode")) ? parseInt(item.getAttribute("custom-heading-mode")) : window.siyuan.config.editor.headingEmbedMode,
                        breadcrumb
                    }, (response) => {
                        renderEmbed(response.data.blocks || [], protyle, item, top);
                    });
                } else {
                    return;
                }
            } catch (e) {
                renderEmbed([], protyle, item, top, e);
            }
        } else {
            fetchPost("/api/search/searchEmbedBlock", {
                embedBlockID: item.getAttribute("data-node-id"),
                stmt: content,
                headingMode: ["0", "1", "2"].includes(item.getAttribute("custom-heading-mode")) ? parseInt(item.getAttribute("custom-heading-mode")) : window.siyuan.config.editor.headingEmbedMode,
                excludeIDs: [item.getAttribute("data-node-id"), protyle.block.rootID],
                breadcrumb
            }, (response) => {
                renderEmbed(response.data.blocks, protyle, item, top);
            });
        }
    });
};

const renderEmbed = (blocks: {
    block: IBlock,
    blockPaths: IBreadcrumb[]
}[], protyle: IProtyle, item: HTMLElement, top?: number, errorTip?: string) => {
    const rotateElement = item.querySelector(".fn__rotate");
    if (rotateElement) {
        rotateElement.classList.remove("fn__rotate");
    }
    let html = "";
    blocks.forEach((blocksItem) => {
        let breadcrumbHTML = "";
        if (blocksItem.blockPaths.length !== 0) {
            breadcrumbHTML = genBreadcrumb(blocksItem.blockPaths, true);
        }
        html += `<div class="protyle-wysiwyg__embed" data-id="${blocksItem.block.id}">${breadcrumbHTML}${blocksItem.block.content}</div>`;
    });
    if (blocks.length > 0) {
        item.firstElementChild.insertAdjacentHTML("afterend", html);
        improveBreadcrumbAppearance(item.querySelector(".protyle-wysiwyg__embed"));
    } else {
        item.firstElementChild.insertAdjacentHTML("afterend", `<div class="protyle-wysiwyg__embed ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${errorTip || window.siyuan.languages.refExpired}</div>`);
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
};
