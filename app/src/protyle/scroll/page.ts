import {isDocumentBoundaryLoaded} from "../util/documentRange";

export type TPageScrollDirection = "up" | "down";

export const getPageScrollTop = (scrollTop: number, scrollHeight: number, clientHeight: number,
                                 direction: TPageScrollDirection) => {
    const distance = Math.max(0, clientHeight - 60);
    const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
    const targetScrollTop = direction === "up" ? scrollTop - distance : scrollTop + distance;
    return Math.min(maximumScrollTop, Math.max(0, targetScrollTop));
};

export const scrollPage = (protyle: IProtyle, direction: TPageScrollDirection) => {
    const element = protyle.contentElement;
    element.scrollTop = getPageScrollTop(element.scrollTop, element.scrollHeight, element.clientHeight, direction);
    protyle.scroll.lastScrollTop = element.scrollTop + (direction === "up" ? 1 : -1);
};

export const scrollPageWithLoading = (protyle: IProtyle, direction: TPageScrollDirection) => {
    const element = protyle.contentElement;
    if (protyle.wysiwyg.element.hasAttribute("data-top")) {
        return;
    }
    const startTop = element.scrollTop;
    const distance = Math.max(0, element.clientHeight - 60);
    if (!distance) {
        return;
    }
    scrollPage(protyle, direction);
    if (protyle.scroll.lastScrollTop === -1) {
        protyle.scroll.lastScrollTop = 0;
    }
    const position = direction === "up" ? "before" : "after";
    const atBoundary = direction === "up" ? element.scrollTop === 0 :
        element.scrollTop >= element.scrollHeight - element.clientHeight;
    if (!atBoundary || protyle.block.showAll || !protyle.block.scroll ||
        isDocumentBoundaryLoaded(protyle.wysiwyg.element, position)) {
        return;
    }
    const remaining = Math.max(0, distance - Math.abs(element.scrollTop - startTop));
    const rootID = protyle.block.rootID;
    const boundaryTop = element.scrollTop;
    let pendingDistance = remaining;
    // 触及已加载内容的边界时补充区块，再完成本次翻屏尚未滚动的距离。
    protyle.scroll.loadDynamic(protyle, direction === "up" ? 1 : 2, {
        suppressFocus: true,
        beforeApply: () => {
            if (element.scrollTop !== boundaryTop) {
                pendingDistance = 0;
            }
        },
        onFinish: success => {
            if (!success || !pendingDistance || rootID !== protyle.block.rootID || !protyle.element.isConnected) {
                return;
            }
            const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
            element.scrollTop = Math.min(maximum, Math.max(0,
                element.scrollTop + (direction === "up" ? -pendingDistance : pendingDistance)));
            protyle.scroll.lastScrollTop = element.scrollTop;
        },
    });
};
