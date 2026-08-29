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
