import {scrollSettingContent} from "./dragScroll";

// 顶部渐变毛玻璃固定覆盖边距，内容从其后方滚动，同时支持拖拽。
export const initSettingDrag = (dialog: HTMLElement) => {
    const wrap = dialog.querySelector<HTMLElement>(".config__tab-wrap");
    const handle = document.createElement("div");
    handle.className = "config__drag resize__move";
    handle.setAttribute("aria-hidden", "true");
    wrap.append(handle);
    const onWheel = (event: WheelEvent) => {
        const panel = Array.from(wrap.querySelectorAll<HTMLElement>(":scope > .config__tab-container"))
            .find(element => element.getClientRects().length > 0);
        if (!panel) {
            return;
        }
        // 集市滚动当前分类，资源滚动列表，避免误滚动资源预览或隐藏的分类。
        const content = Array.from(panel.querySelectorAll<HTMLElement>(".config-bazaar__panel, .config-assets__list"))
            .find(element => element.getClientRects().length > 0) || panel;
        scrollSettingContent(content, event);
    };
    handle.addEventListener("wheel", onWheel, {passive: false});
    let frame = 0;
    const update = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        const panel = Array.from(wrap.querySelectorAll<HTMLElement>(":scope > .config__tab-container"))
            .find(element => element.getClientRects().length > 0);
        const className = `config__drag resize__move${panel ?
            (["bazaar", "assets"].includes(panel.dataset.name) ? " config__drag--tabs" : "") : " fn__none"}`;
        if (handle.className !== className) {
            handle.className = className;
        }
        if (panel && !["bazaar", "assets"].includes(panel.dataset.name)) {
            // 搜索过滤后也只移除首尾可见分组的外侧间距，避免与固定留白叠加。
            const visible = Array.from(panel.children).filter(element => element.getClientRects().length > 0);
            const first = visible[0];
            const last = visible[visible.length - 1];
            panel.querySelectorAll(":scope > .config-group").forEach(group => {
                const isFirst = group === first;
                if (group.classList.contains("config-group--first") !== isFirst) {
                    group.classList.toggle("config-group--first", isFirst);
                }
                const isLast = group === last;
                if (group.classList.contains("config-group--last") !== isLast) {
                    group.classList.toggle("config-group--last", isLast);
                }
            });
        }
    };
    const schedule = () => {
        if (!frame) {
            frame = requestAnimationFrame(update);
        }
    };
    const observer = new MutationObserver(schedule);
    observer.observe(wrap, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
    schedule();
    return () => {
        handle.removeEventListener("wheel", onWheel);
        cancelAnimationFrame(frame);
        observer.disconnect();
    };
};
