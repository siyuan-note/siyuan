import {hasClosestByAttribute} from "../util/hasClosest";

const pendingBreadcrumbs = new Set<HTMLElement>();
let appearanceFrame = 0;

export const improveBreadcrumbAppearance = (element: HTMLElement) => {
    if (element.classList.contains("protyle-breadcrumb__bar")) {
        pendingBreadcrumbs.add(element);
    }
    element.querySelectorAll<HTMLElement>(".protyle-breadcrumb__bar").forEach(item => pendingBreadcrumbs.add(item));
    if (appearanceFrame || pendingBreadcrumbs.size === 0) {
        return;
    }
    appearanceFrame = requestAnimationFrame(() => {
        appearanceFrame = 0;
        const elements = Array.from(pendingBreadcrumbs).filter(item => item.isConnected);
        pendingBreadcrumbs.clear();
        elements.forEach(item => item.classList.remove("protyle-breadcrumb__bar--nowrap"));
        const bars = elements.map(item => ({
            element: item,
            texts: Array.from(item.querySelectorAll<HTMLElement>(".protyle-breadcrumb__text")),
            start: hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed") ? 1 : 0,
        })).filter(item => item.texts.length > 0);
        let pending = bars.filter(item => item.texts.length > 1);
        while (pending.length > 0) {
            // 每轮先统一测量，再缩短各面包屑中的一个标签，避免逐项读写布局。
            pending = pending.filter(item => item.element.scrollHeight > 30 &&
                item.texts.slice(item.start).some(text => !text.classList.contains("protyle-breadcrumb__text--ellipsis")));
            pending.forEach(item => item.texts.slice(item.start)
                .find(text => !text.classList.contains("protyle-breadcrumb__text--ellipsis"))
                .classList.add("protyle-breadcrumb__text--ellipsis"));
        }
        bars.forEach(item => item.element.classList.add("protyle-breadcrumb__bar--nowrap"));
        const positions = bars.map(item => ({
            element: item.element,
            left: item.element.lastElementChild ?
                (item.element.lastElementChild as HTMLElement).offsetLeft - item.element.clientWidth + 14 : 0,
        }));
        positions.forEach(item => item.element.scrollLeft = item.left);
    });
};
