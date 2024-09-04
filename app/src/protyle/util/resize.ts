import {hideElements} from "../ui/hideElements";
import {setPadding} from "../ui/initUI";
import {hasClosestBlock} from "./hasClosest";
import {Constants} from "../../constants";
import {lineNumberRender} from "../render/highlightRender";
import {stickyRow} from "../render/av/row";

export const resize = (protyle: IProtyle) => {
    hideElements(["gutterOnly"], protyle);
    const abs = setPadding(protyle);
    const MIN_ABS = 4;
    // 不能 clearTimeout，否则 split 时左侧无法 resize
    setTimeout(() => {
        if (!protyle.disabled) {
            const contentRect = protyle.contentElement.getBoundingClientRect();
            protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
                if (item.querySelector(".av__title")) {
                    stickyRow(item, contentRect, "all");
                }
            });
        }
        if (abs.width > MIN_ABS || isNaN(abs.width)) {
            if (typeof window.echarts !== "undefined") {
                protyle.wysiwyg.element.querySelectorAll('[data-subtype="echarts"], [data-subtype="mindmap"]').forEach((chartItem: HTMLElement) => {
                    const chartInstance = window.echarts.getInstanceById(chartItem.firstElementChild.nextElementSibling.getAttribute("_echarts_instance_"));
                    if (chartInstance) {
                        chartInstance.resize();
                    }
                });
            }
            protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber__rows").forEach((item: HTMLElement) => {
                if ((item.nextElementSibling as HTMLElement).style.wordBreak === "break-word") {
                    lineNumberRender(item.parentElement);
                }
            });
            // 保持光标位置不变 https://ld246.com/article/1673704873983/comment/1673765814595#comments
            if (!protyle.disabled && protyle.toolbar.range) {
                let rangeRect = protyle.toolbar.range.getBoundingClientRect();
                if (rangeRect.height === 0) {
                    const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
                    if (blockElement) {
                        rangeRect = blockElement.getBoundingClientRect();
                    }
                }
                if (rangeRect.height === 0) {
                    return;
                }
                const protyleRect = protyle.element.getBoundingClientRect();
                if (protyleRect.top + 30 > rangeRect.top || protyleRect.bottom < rangeRect.bottom) {
                    protyle.toolbar.range.startContainer.parentElement.scrollIntoView(protyleRect.top > rangeRect.top);
                }
            }
        }
    }, Constants.TIMEOUT_TRANSITION);   // 等待 setPadding 动画结束
};
