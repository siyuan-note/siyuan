import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {isMobile} from "../../util/functions";
import {stickyRow} from "../render/av/row";
import {trimAVRowsSync} from "../render/av/virtualScroll";
import {isDocumentBoundaryLoaded} from "../util/documentRange";
import {getVisibleRootBlockID, isScrolledToBottom} from "./viewport";

let getIndexTimeout: number;
const avScrollPending = new WeakSet<HTMLElement>();
export const scrollEvent = (protyle: IProtyle, element: HTMLElement) => {
    element.addEventListener("scroll", () => {
        const elementRect = element.getBoundingClientRect();
        if (!protyle.toolbar.element.classList.contains("fn__none")) {
            const initY = protyle.toolbar.element.getAttribute("data-inity").split(Constants.ZWSP);
            const top = parseInt(initY[0]) + (parseInt(initY[1]) - element.scrollTop);
            if (top < elementRect.top - protyle.toolbar.toolbarHeight || top > elementRect.bottom - protyle.toolbar.toolbarHeight) {
                protyle.toolbar.element.style.display = "none";
            } else {
                protyle.toolbar.element.style.top = top + "px";
                protyle.toolbar.element.style.display = "";
            }
        }

        protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
            if (item.dataset.render !== "true") {
                return;
            }
            // stickyRow 与 trimAVRows 合并到每块每帧一个 rAF：先 stickyRow（读布局为主），
            // 再 trimAVRowsSync（增删行）。合并避免两个独立 rAF 跨回调读写交错触发重排；
            // 先读后写避免 trim 的 DOM 写入让 sticky 的几何读取成为强制重排。
            if (avScrollPending.has(item)) {
                return;
            }
            avScrollPending.add(item);
            requestAnimationFrame(() => {
                avScrollPending.delete(item);
                stickyRow(item, element, "all");
                trimAVRowsSync(item, elementRect);
            });
        });

        if (!protyle.element.classList.contains("block__edit") && !isMobile()) {
            protyle.contentElement.setAttribute("data-scrolltop", element.scrollTop.toString());
        }

        if (!window.siyuan.dragElement) { // https://ld246.com/article/1649638389841
            hideElements(["gutterOnly"], protyle);
        }

        if (protyle.scroll && !protyle.scroll.element.classList.contains("fn__none")) {
            clearTimeout(getIndexTimeout);
            getIndexTimeout = window.setTimeout(() => {
                if (element.scrollTop <= 1 && isDocumentBoundaryLoaded(protyle.wysiwyg.element, "before")) {
                    protyle.scroll.setCurrentIndex(protyle, 1, true);
                    return;
                }
                if (isScrolledToBottom(element.scrollTop, element.scrollHeight, element.clientHeight) &&
                    isDocumentBoundaryLoaded(protyle.wysiwyg.element, "after")) {
                    protyle.scroll.setCurrentIndex(protyle, protyle.block.blockCount, true);
                    return;
                }
                const visibleBlockID = getVisibleRootBlockID(
                    Array.from(protyle.wysiwyg.element.children).map((item) => {
                        const rect = item.getBoundingClientRect();
                        return {
                            id: item.getAttribute("data-node-id"),
                            top: rect.top,
                            bottom: rect.bottom,
                        };
                    }),
                    elementRect.top + 10,
                    elementRect.bottom,
                );
                if (visibleBlockID) {
                    protyle.scroll.updateIndex(protyle, visibleBlockID);
                }
            }, Constants.TIMEOUT_LOAD);
        }

        if (protyle.wysiwyg.element.getAttribute("data-top") || protyle.block.showAll ||
            (protyle.scroll && protyle.scroll.element.classList.contains("fn__none")) || !protyle.scroll ||
            protyle.scroll.lastScrollTop === element.scrollTop || protyle.scroll.lastScrollTop === -1 ||
            // 移动端跳转的时候会设置 wysiwyg.element.innerHTML = "";
            !protyle.wysiwyg.element.firstElementChild) {
            return;
        }
        const firstElement = protyle.wysiwyg.element.firstElementChild;
        const lastElement = protyle.wysiwyg.element.lastElementChild;
        const firstId = firstElement.getAttribute("data-node-id");
        const lastId = lastElement?.getAttribute("data-node-id");
        if (protyle.scroll.lastScrollTop > element.scrollTop) {
            if (element.scrollTop === 0) {
                // 使用鼠标拖拽滚动条中无法准确获取 scrollTop，在此忽略
                return;
            }
            if (element.scrollTop < element.clientHeight &&
                firstId && firstElement.getAttribute("data-eof") !== "1") {
                // 禁用滚动时会产生抖动 https://ld246.com/article/1666717094418
                const clearLoadingStyle = () => {
                    protyle.contentElement.style.overflow = "";
                    protyle.contentElement.style.width = "";
                };
                if (protyle.scroll.loadDynamic(protyle, 1, {
                    beforeApply: clearLoadingStyle,
                    onFinish: clearLoadingStyle,
                })) {
                    protyle.contentElement.style.width = (protyle.contentElement.offsetWidth) + "px";
                    protyle.contentElement.style.overflow = "hidden";
                }
            }
        } else if ((element.scrollTop > element.scrollHeight - element.clientHeight * 1.8) &&
            lastElement && lastId && lastElement.getAttribute("data-eof") !== "2") {
            if (protyle.scroll.lastScrollTop > 768 && element.scrollTop > protyle.scroll.lastScrollTop * 2) {
                // 使用鼠标拖拽滚动条时导致加载需进行矫正
                element.scrollTop = protyle.scroll.lastScrollTop;
                return;
            }
            protyle.scroll.loadDynamic(protyle, 2);
        }
        protyle.scroll.lastScrollTop = Math.max(element.scrollTop, 0);
    }, {
        capture: false,
        passive: true,
        once: false
    });
};
