import {hideElements} from "../ui/hideElements";
import {setPadding} from "../ui/initUI";
import {hasClosestBlock, hasClosestByClassName} from "./hasClosest";
import {Constants} from "../../constants";
import {lineNumberRender} from "../render/highlightRender";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {stickyRow} from "../render/av/row";

export const clearBeforeResizeTop = () => {
    /// #if !MOBILE
    getAllModels().editor.forEach((item) => {
        if (item.editor && item.editor.protyle &&
            item.element.parentElement && !item.element.classList.contains("fn__none")) {
            item.editor.protyle.wysiwyg.element.querySelector("[data-resize-top]")?.removeAttribute("data-resize-top");
        }
    });
    /// #endif
};

export const recordBeforeResizeTop = () => {
    /// #if !MOBILE
    getAllModels().editor.forEach((item) => {
        if (item.editor && item.editor.protyle &&
            item.element.parentElement && !item.element.classList.contains("fn__none")) {
            item.editor.protyle.wysiwyg.element.querySelector("[data-resize-top]")?.removeAttribute("data-resize-top");
            const contentRect = item.editor.protyle.contentElement.getBoundingClientRect();
            let topElement = document.elementFromPoint(contentRect.left + (contentRect.width / 2), contentRect.top);
            if (hasClosestByClassName(topElement, "b3-menu")) {
                window.siyuan.menus.menu.remove();
                topElement = document.elementFromPoint(contentRect.left + (contentRect.width / 2), contentRect.top);
            }
            if (!topElement) {
                topElement = document.elementFromPoint(contentRect.left + (contentRect.width / 2), contentRect.top + 17);
            }
            if (!topElement) {
                return;
            }
            topElement = hasClosestBlock(topElement) as HTMLElement;
            if (!topElement) {
                return;
            }
            topElement.setAttribute("data-resize-top", (contentRect.top - topElement.getBoundingClientRect().top).toString());
        }
    });
    /// #endif
};

export const restoreBeforeResizeTop = (protyle: IProtyle, clear = true) => {
    const topElement = protyle.wysiwyg.element.querySelector("[data-resize-top]");
    if (!topElement) {
        return false;
    }
    // 只调整编辑器的滚动位置，避免滚动外层布局，并保留块内的小数偏移。
    protyle.contentElement.scrollTop += topElement.getBoundingClientRect().top -
        protyle.contentElement.getBoundingClientRect().top + parseFloat(topElement.getAttribute("data-resize-top"));
    if (clear) {
        topElement.removeAttribute("data-resize-top");
    }
    return true;
};

export const resize = (protyle: IProtyle) => {
    hideElements(["gutterOnly"], protyle);
    const abs = setPadding(protyle);
    const MIN_ABS = 4;
    // 不能 clearTimeout，否则 split 时左侧无法 resize
    setTimeout(() => {
        if (protyle.scroll && protyle.scroll.element.parentElement.getAttribute("style")) {
            protyle.scroll.element.parentElement.setAttribute("style", `--b3-dynamicscroll-width:${Math.min(protyle.contentElement.clientHeight - 49, 200)}px`);
        }
        protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
            stickyRow(item, protyle.contentElement, "all");
        });
        if (abs.width > MIN_ABS || isNaN(abs.width)) {
            if (typeof window.echarts !== "undefined") {
                protyle.wysiwyg.element.querySelectorAll('[data-subtype="echarts"]').forEach((chartItem: HTMLElement) => {
                    const chartInstance = window.echarts.getInstanceById(chartItem.querySelector("[_echarts_instance_]").getAttribute("_echarts_instance_"));
                    if (chartInstance) {
                        chartInstance.resize();
                    }
                });
            }
        }
        // 小于 MIN_ABS 也会导致换行 https://github.com/siyuan-note/siyuan/issues/13677
        protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber__rows").forEach((item: HTMLElement) => {
            if ((item.nextElementSibling as HTMLElement).style.wordBreak === "break-word") {
                lineNumberRender(item.parentElement);
            }
        });
        restoreBeforeResizeTop(protyle);
    }, Constants.TIMEOUT_TRANSITION + 100);   // 等待 setPadding 动画结束
};
