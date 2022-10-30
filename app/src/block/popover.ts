import {BlockPanel} from "./Panel";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchSyncPost} from "../util/fetch";
import {hideTooltip, showTooltip} from "../dialog/tooltip";

let popoverTargetElement: HTMLElement;
export const initBlockPopover = () => {
    let timeout: number;
    let timeoutHide: number;
    // 编辑器内容块引用/backlinks/tag/bookmark/套娃中使用
    document.addEventListener("mouseover", (event: MouseEvent & { target: HTMLElement }) => {
        if (!window.siyuan.config) {
            return;
        }
        const aElement = hasClosestByAttribute(event.target, "data-type", "a", true) ||
            hasClosestByAttribute(event.target, "data-type", "tab-header") ||
            hasClosestByClassName(event.target, "emojis__item") ||
            hasClosestByClassName(event.target, "emojis__type") ||
            hasClosestByAttribute(event.target, "data-type", "inline-memo");
        if (aElement) {
            let tip = aElement.getAttribute("aria-label") || aElement.getAttribute("data-inline-memo-content");
            // 折叠块标文案替换
            if (hasClosestByAttribute(event.target, "data-type", "fold", true)) {
                tip = window.siyuan.languages.fold;
            }
            if (!tip) {
                tip = aElement.getAttribute("data-href");
                const title = aElement.getAttribute("data-title");
                if (title) {
                    tip += "<br>" + title;
                }
            }
            if (tip && !tip.startsWith("siyuan://blocks") && !aElement.classList.contains("b3-tooltips")) {
                showTooltip(tip, aElement);
                event.stopPropagation();
                return;
            }
        } else if (!aElement) {
            hideTooltip();
        }
        if (window.siyuan.config.editor.floatWindowMode === 1) {
            clearTimeout(timeoutHide);
            timeoutHide = window.setTimeout(() => {
                hidePopover(event);
            }, 200);

            if (!getTarget(event, aElement)) {
                return;
            }
            if (window.siyuan.ctrlIsPressed) {
                clearTimeout(timeoutHide);
                showPopover();
            }
            return;
        }

        clearTimeout(timeout);
        clearTimeout(timeoutHide);
        timeoutHide = window.setTimeout(() => {
            if (!hidePopover(event)) {
                return;
            }
            if (!popoverTargetElement && !aElement) {
                clearTimeout(timeout);
            }
        }, 200);
        timeout = window.setTimeout(async () => {
            if (!getTarget(event, aElement)) {
                return;
            }
            clearTimeout(timeoutHide);
            showPopover();
        }, 620);
    });
};

const hidePopover = (event: MouseEvent & { target: HTMLElement }) => {
    if (hasClosestByClassName(event.target, "b3-menu") ||
        (event.target.id && event.target.tagName !== "svg" && (event.target.id.startsWith("minder_node") || event.target.id.startsWith("kity_") || event.target.id.startsWith("node_")))
        || event.target.classList.contains("counter")
        || event.target.tagName === "circle"
    ) {
        // b3-menu 需要处理，(( 后的 hint 上的图表移上去需显示预览
        // gutter & mindmap & 文件树上的数字 & 关系图节点不处理
        return false;
    }
    popoverTargetElement = hasClosestByAttribute(event.target, "data-type", "block-ref") as HTMLElement ||
        hasClosestByAttribute(event.target, "data-type", "virtual-block-ref") as HTMLElement;
    if (popoverTargetElement && popoverTargetElement.classList.contains("b3-tooltips")) {
        popoverTargetElement = undefined;
    }
    if (!popoverTargetElement) {
        popoverTargetElement = hasClosestByClassName(event.target, "popover__block") as HTMLElement;
    }
    const linkElement = hasClosestByAttribute(event.target, "data-type", "a", true);
    if (!popoverTargetElement && linkElement && linkElement.getAttribute("data-href")?.startsWith("siyuan://blocks")) {
        popoverTargetElement = linkElement;
    }
    if (!popoverTargetElement) {
        const blockElement = hasClosestByClassName(event.target, "block__popover", true);
        const maxEditLevels: { [key: string]: number } = {oid: 0};
        window.siyuan.blockPanels.forEach((item) => {
            if (item.targetElement && item.element.getAttribute("data-pin") === "true") {
                const level = parseInt(item.element.getAttribute("data-level"));
                const oid = item.element.getAttribute("data-oid");
                if (maxEditLevels[oid]) {
                    if (level > maxEditLevels[oid]) {
                        maxEditLevels[oid] = level;
                    }
                } else {
                    maxEditLevels[oid] = level; // 不能为1，否则 pin 住第三层，第二层会消失
                }
            }
        });
        if (blockElement) {
            for (let i = 0; i < window.siyuan.blockPanels.length; i++) {
                const item = window.siyuan.blockPanels[i];
                if (item.targetElement &&
                    parseInt(item.element.getAttribute("data-level")) > (maxEditLevels[item.element.getAttribute("data-oid")] || 0) &&
                    item.element.getAttribute("data-pin") === "false" &&
                    parseInt(item.element.getAttribute("data-level")) > parseInt(blockElement.getAttribute("data-level"))) {
                    item.destroy();
                    i--;
                }
            }
        } else {
            for (let i = 0; i < window.siyuan.blockPanels.length; i++) {
                const item = window.siyuan.blockPanels[i];
                if (item.targetElement && item.element.getAttribute("data-pin") === "false" &&
                    parseInt(item.element.getAttribute("data-level")) > (maxEditLevels[item.element.getAttribute("data-oid")] || 0)) {
                    item.destroy();
                    i--;
                }
            }
        }
    }
};

const getTarget = (event: MouseEvent & { target: HTMLElement }, aElement: false | HTMLElement) => {
    if (hasClosestByClassName(event.target, "history__repo", true)) {
        return false;
    }
    popoverTargetElement = hasClosestByAttribute(event.target, "data-type", "block-ref") as HTMLElement ||
        hasClosestByAttribute(event.target, "data-type", "virtual-block-ref") as HTMLElement;
    if (popoverTargetElement && popoverTargetElement.classList.contains("b3-tooltips")) {
        popoverTargetElement = undefined;
    }
    if (!popoverTargetElement) {
        popoverTargetElement = hasClosestByClassName(event.target, "popover__block") as HTMLElement;
    }
    if (!popoverTargetElement && aElement && aElement.getAttribute("data-href")?.startsWith("siyuan://blocks") &&
        aElement.getAttribute("prevent-popover") !== "true") {
        popoverTargetElement = aElement;
    }
    if (!popoverTargetElement || window.siyuan.altIsPressed || window.siyuan.shiftIsPressed ||
        (window.siyuan.config.editor.floatWindowMode === 0 && window.siyuan.ctrlIsPressed) ||
        (popoverTargetElement && popoverTargetElement.getAttribute("prevent-popover") === "true")) {
        return false;
    }
    // https://github.com/siyuan-note/siyuan/issues/4314
    if (popoverTargetElement && getSelection().rangeCount > 0) {
        const range = getSelection().getRangeAt(0);
        if (range.toString() !== "" && popoverTargetElement.contains(range.startContainer)) {
            return false;
        }
    }
    return true;
};

export const showPopover = async () => {
    if (!popoverTargetElement) {
        return;
    }
    let ids: string[];
    let defIds: string[];
    const dataId = popoverTargetElement.getAttribute("data-id");
    if (dataId) {
        // backlink/util/hint/正文标题 上的弹层
        if (dataId.startsWith("[")) {
            ids = JSON.parse(dataId);
        } else {
            ids = [dataId];
        }
        defIds = JSON.parse(popoverTargetElement.getAttribute("data-defids") || "[]");
    } else if (popoverTargetElement.getAttribute("data-type")?.indexOf("virtual-block-ref") > -1) {
        const nodeElement = hasClosestBlock(popoverTargetElement);
        if (nodeElement) {
            const postResponse = await fetchSyncPost("/api/block/getBlockDefIDsByRefText", {
                anchor: popoverTargetElement.textContent,
                excludeIDs: [nodeElement.getAttribute("data-node-id")]
            });
            ids = postResponse.data;
        }
    } else if (popoverTargetElement.getAttribute("data-type")?.split(" ").includes("a")) {
        // 以思源协议开头的链接
        ids = [popoverTargetElement.getAttribute("data-href").substr(16, 22)];
    } else {
        // pdf
        let targetId;
        let url = "/api/block/getRefIDs";
        if (popoverTargetElement.classList.contains("protyle-attr--refcount")) {
            // 编辑器中的引用数
            targetId = popoverTargetElement.parentElement.parentElement.getAttribute("data-node-id");
        } else if (popoverTargetElement.classList.contains("pdf__rect")) {
            targetId = popoverTargetElement.getAttribute("data-node-id");
            url = "/api/block/getRefIDsByFileAnnotationID";
        } else if (!targetId) {
            // 文件树中的引用数
            targetId = popoverTargetElement.parentElement.getAttribute("data-node-id");
        }
        const postResponse = await fetchSyncPost(url, {id: targetId});
        ids = postResponse.data.refIDs;
        defIds = postResponse.data.defIDs;
    }

    let hasPin = false;
    window.siyuan.blockPanels.find((item) => {
        if (item.targetElement && item.element.getAttribute("data-pin") === "true"
            && JSON.stringify(ids) === JSON.stringify(item.nodeIds)) {
            hasPin = true;
            return true;
        }
    });
    if (!hasPin &&
        popoverTargetElement.parentElement.style.opacity !== "0.1" // 反向面板图标拖拽时不应该弹层
    ) {
        window.siyuan.blockPanels.push(new BlockPanel({
            targetElement: popoverTargetElement,
            nodeIds: ids,
            defIds,
        }));
    }
    popoverTargetElement = undefined;
};
