import {getSelectionPosition} from "../../protyle/util/selection";
import {getVisibleViewportBounds} from "./visibleViewport";

export const bindEmojiSheetSelection = (sheet: HTMLElement, range: Range) => {
    const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE ?
        range.startContainer as HTMLElement : range.startContainer.parentElement;
    const content = anchor?.closest<HTMLElement>(".protyle-content");
    if (!content) {
        return () => {};
    }
    // 在编辑区域外补足滚动空间，使文档末尾的输入位置也能移到面板上方。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.flexShrink = "0";
    spacer.style.pointerEvents = "none";
    content.append(spacer);
    let frame = 0;
    const update = () => {
        frame = 0;
        if (!sheet.isConnected || !content.contains(range.startContainer)) {
            return;
        }
        const viewport = getVisibleViewportBounds();
        const contentRect = content.getBoundingClientRect();
        // 使用面板的布局高度，避免入场动画和下拉手势影响避让位置。
        const dialogRect = sheet.parentElement.getBoundingClientRect();
        const dialogStyle = getComputedStyle(sheet.parentElement);
        const sheetTop = dialogRect.bottom - parseFloat(dialogStyle.paddingBottom || "0") - sheet.offsetHeight;
        const bottom = Math.min(contentRect.bottom, viewport.bottom, sheetTop);
        const top = Math.max(contentRect.top, viewport.top);
        if (bottom <= top) {
            return;
        }
        const lineHeight = parseFloat(getComputedStyle(anchor).lineHeight) ||
            window.siyuan.config.editor.fontSize * 1.625;
        spacer.style.height = `${Math.max(0, contentRect.bottom - bottom) + lineHeight}px`;
        const cursorTop = getSelectionPosition(content, range.cloneRange()).top;
        const visibleCursorTop = Math.max(top, bottom - lineHeight * 2);
        if (cursorTop > visibleCursorTop) {
            content.scrollTop += cursorTop - visibleCursorTop;
        } else if (cursorTop < top) {
            content.scrollTop += cursorTop - top;
        }
    };
    const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(sheet);
    observer.observe(content);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.visualViewport?.removeEventListener("resize", schedule);
        window.visualViewport?.removeEventListener("scroll", schedule);
        spacer.remove();
    };
};
