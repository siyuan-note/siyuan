import {scrollSettingContent} from "./dragScroll";

// 拖拽层仅覆盖首组标题及现有留白，随滚动和面板切换更新，避开控件及滚动条。
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
        let height = 0;
        let width = 0;
        if (panel) {
            const top = wrap.getBoundingClientRect().top;
            width = panel.clientWidth;
            let first = Array.from(panel.children).find(element => element.getClientRects().length > 0);
            // 穿过纯布局容器，找到实际首项；嵌套页面的工具栏也在此处形成边界。
            while (first && !first.matches(".config-group, .layout-tab-bar, .b3-label, .b3-dialog__header")) {
                const child = Array.from(first.children).find(element => element.getClientRects().length > 0);
                if (!child) {
                    break;
                }
                first = child;
            }
            if (first) {
                height = Math.min(24, first.getBoundingClientRect().top - top);
                if (first.matches(".layout-tab-bar")) {
                    // 使用页签实际顶边识别内边距及外边距，热区不覆盖可点击的页签。
                    const items = Array.from(first.children).filter(element => element.getClientRects().length > 0);
                    if (items.length > 0) {
                        height = Math.min(24, ...items.map(element => element.getBoundingClientRect().top - top));
                    }
                } else if (first.matches(".config-group")) {
                    const title = first.querySelector<HTMLElement>(":scope > .config-title");
                    const items = first.querySelector<HTMLElement>(":scope > .config-items");
                    if (title?.getClientRects().length && items &&
                        !title.querySelector("button, input, select, textarea, a, label, [contenteditable], [role], [tabindex], [data-type], [data-action], .block__icon")) {
                        height = items.getBoundingClientRect().top - top;
                    }
                }
            }
        }
        handle.style.width = `${width}px`;
        handle.style.height = `${Math.max(0, height)}px`;
    };
    const schedule = () => {
        if (!frame) {
            frame = requestAnimationFrame(update);
        }
    };
    const observer = new MutationObserver(schedule);
    observer.observe(wrap, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(wrap);
    wrap.addEventListener("scroll", update, true);
    dialog.addEventListener("transitionend", schedule);
    schedule();
    return () => {
        handle.removeEventListener("wheel", onWheel);
        cancelAnimationFrame(frame);
        observer.disconnect();
        resizeObserver.disconnect();
        wrap.removeEventListener("scroll", update, true);
        dialog.removeEventListener("transitionend", schedule);
    };
};
