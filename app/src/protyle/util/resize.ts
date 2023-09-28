import {hideElements} from "../ui/hideElements";
import {setPadding} from "../ui/initUI";
import {hasClosestBlock} from "./hasClosest";
import {Constants} from "../../constants";
import {lineNumberRender} from "../render/highlightRender";

export const resize = (protyle: IProtyle) => {
    hideElements(["gutter"], protyle);
    const abs = setPadding(protyle);
    const MIN_ABS = 4;
    // 不能 clearTimeout，否则 split 时左侧无法 resize
    setTimeout(() => {
        if (abs.width > MIN_ABS || isNaN(abs.width)) {
            if (typeof window.echarts !== "undefined") {
                protyle.wysiwyg.element.querySelectorAll('[data-subtype="echarts"], [data-subtype="mindmap"]').forEach((chartItem: HTMLElement) => {
                    const chartInstance = window.echarts.getInstanceById(chartItem.firstElementChild.nextElementSibling.getAttribute("_echarts_instance_"));
                    if (chartInstance) {
                        chartInstance.resize();
                    }
                });
            }
            if (window.siyuan.config.editor.codeSyntaxHighlightLineNum) {
                protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber").forEach((block: HTMLElement) => {
                    lineNumberRender(block);
                });
            }
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
        if (abs.padding > MIN_ABS || abs.width > MIN_ABS || isNaN(abs.padding)) {
            protyle.wysiwyg.element.querySelectorAll(".av").forEach((item: HTMLElement) => {
                item.style.width = item.parentElement.clientWidth + "px";
                if (item.getAttribute("data-render") === "true") {
                    const paddingLeft = item.parentElement.style.paddingLeft;
                    const paddingRight = item.parentElement.style.paddingRight;
                    const avHeaderElement = item.firstElementChild.firstElementChild as HTMLElement;
                    avHeaderElement.style.paddingLeft = paddingLeft;
                    avHeaderElement.style.paddingRight = paddingRight;
                    const avBodyElement = item.querySelector(".av__scroll").firstElementChild as HTMLElement;
                    avBodyElement.style.paddingLeft = paddingLeft;
                    avBodyElement.style.paddingRight = paddingRight;
                }
            });
        }
    }, Constants.TIMEOUT_TRANSITION);   // 等待 setPadding 动画结束
};
