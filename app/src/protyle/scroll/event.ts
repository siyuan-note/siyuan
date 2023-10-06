import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {isMobile} from "../../util/functions";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";

let getIndexTimeout: number;
export const scrollEvent = (protyle: IProtyle, element: HTMLElement) => {
    let elementRect = element.getBoundingClientRect();
    element.addEventListener("scroll", () => {
        if (!protyle.toolbar.element.classList.contains("fn__none")) {
            const initY = protyle.toolbar.element.getAttribute("data-inity").split(Constants.ZWSP);
            const top = parseInt(initY[0]) + (parseInt(initY[1]) - element.scrollTop);
            if (elementRect.width === 0) {
                elementRect = element.getBoundingClientRect();
            }
            const toolbarHeight = 29;
            if (top < elementRect.top - toolbarHeight || top > elementRect.bottom - toolbarHeight) {
                protyle.toolbar.element.style.display = "none";
            } else {
                protyle.toolbar.element.style.top = top + "px";
                protyle.toolbar.element.style.display = "";
            }
        }

        if (!protyle.element.classList.contains("block__edit") && !isMobile()) {
            protyle.contentElement.setAttribute("data-scrolltop", element.scrollTop.toString());
        }

        if (!window.siyuan.dragElement) { // https://ld246.com/article/1649638389841
            hideElements(["gutter"], protyle);
        }

        if (protyle.scroll && !protyle.scroll.element.classList.contains("fn__none")) {
            clearTimeout(getIndexTimeout);
            getIndexTimeout = window.setTimeout(() => {
                elementRect = element.getBoundingClientRect();
                const targetElement = document.elementFromPoint(elementRect.left + elementRect.width / 2, elementRect.top + 10);
                const blockElement = hasClosestBlock(targetElement);
                if (!blockElement) {
                    if ((protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
                        // goHome 时 data-eof 不为 1
                            protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-index") === "0") &&
                        (hasClosestByClassName(targetElement, "protyle-background") || hasClosestByClassName(targetElement, "protyle-title"))) {
                        const inputElement = protyle.scroll.element.querySelector(".b3-slider") as HTMLInputElement;
                        inputElement.value = "1";
                        protyle.scroll.element.setAttribute("aria-label", `Blocks 1/${protyle.block.blockCount}`);
                    }
                    return;
                }
                protyle.scroll.updateIndex(protyle, blockElement.getAttribute("data-node-id"));
            }, Constants.TIMEOUT_LOAD);
        }
        if (protyle.wysiwyg.element.getAttribute("data-top") || protyle.block.showAll ||
            (protyle.scroll && protyle.scroll.element.classList.contains("fn__none")) || !protyle.scroll ||
            protyle.scroll.lastScrollTop === element.scrollTop || protyle.scroll.lastScrollTop === -1) {
            return;
        }
        if (protyle.scroll.lastScrollTop - element.scrollTop > 0) {
            // up
            if (element.scrollTop < element.clientHeight &&
                protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") !== "1") {
                // 禁用滚动时会产生抖动 https://ld246.com/article/1666717094418
                protyle.contentElement.style.width = (protyle.contentElement.clientWidth) + "px";
                protyle.contentElement.style.overflow = "hidden";
                protyle.wysiwyg.element.setAttribute("data-top", element.scrollTop.toString());
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
                    mode: 1,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getResponse => {
                    protyle.contentElement.style.overflow = "";
                    protyle.contentElement.style.width = "";
                    onGet({
                        data: getResponse,
                        protyle,
                        action: [Constants.CB_GET_BEFORE, Constants.CB_GET_UNCHANGEID],
                    });
                });
            }
        } else if ((element.scrollTop > element.scrollHeight - element.clientHeight * 1.8) &&
            protyle.wysiwyg.element.lastElementChild &&
            protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2") {
            protyle.wysiwyg.element.setAttribute("data-top", element.scrollTop.toString());
            fetchPost("/api/filetree/getDoc", {
                id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
                mode: 2,
                size: window.siyuan.config.editor.dynamicLoadBlocks,
            }, getResponse => {
                onGet({
                    data: getResponse,
                    protyle,
                    action: [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID],
                });
            });
        }
        protyle.scroll.lastScrollTop = Math.max(element.scrollTop, 0);
    }, {
        capture: false,
        passive: true,
        once: false
    });
};
