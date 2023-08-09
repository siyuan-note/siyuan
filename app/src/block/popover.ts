import {BlockPanel} from "./Panel";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchSyncPost} from "../util/fetch";
import {hideTooltip, showTooltip} from "../dialog/tooltip";
import {getIdFromSYProtocol} from "../util/pathName";
import {App} from "../index";

let popoverTargetElement: HTMLElement;
export const initBlockPopover = (app: App) => {
    let timeout: number;
    let timeoutHide: number;
    // 编辑器内容块引用/backlinks/tag/bookmark/套娃中使用
    document.addEventListener("mouseover", (event: MouseEvent & { target: HTMLElement, path: HTMLElement[] }) => {
        if (!window.siyuan.config) {
            return;
        }
        const aElement = hasClosestByAttribute(event.target, "data-type", "a", true) ||
            hasClosestByAttribute(event.target, "data-type", "tab-header") ||
            hasClosestByClassName(event.target, "av__celltext") ||
            hasClosestByClassName(event.target, "ariaLabel") ||
            hasClosestByAttribute(event.target, "data-type", "inline-memo");
        if (aElement) {
            let tip = aElement.getAttribute("aria-label") || aElement.getAttribute("data-inline-memo-content");
            // 折叠块标文案替换
            if (hasClosestByAttribute(event.target, "data-type", "fold", true)) {
                tip = window.siyuan.languages.fold;
            }
            if (aElement.classList.contains("av__celltext") && aElement.scrollWidth > aElement.parentElement.clientWidth - 11) {
                tip = aElement.textContent;
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
        } else if (!aElement && !hasClosestByAttribute(event.target, "id", "tooltip", true)) {
            hideTooltip();
        }
        if (window.siyuan.config.editor.floatWindowMode === 1 || window.siyuan.shiftIsPressed) {
            clearTimeout(timeoutHide);
            timeoutHide = window.setTimeout(() => {
                hidePopover(event);
            }, 200);

            if (!getTarget(event, aElement)) {
                return;
            }
            if (window.siyuan.ctrlIsPressed) {
                clearTimeout(timeoutHide);
                showPopover(app);
            } else if (window.siyuan.shiftIsPressed) {
                clearTimeout(timeoutHide);
                showPopover(app, true);
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
        timeout = window.setTimeout(() => {
            if (!getTarget(event, aElement)) {
                return;
            }
            clearTimeout(timeoutHide);
            showPopover(app);
        }, 620);
    });
};

const hidePopover = (event: MouseEvent & { target: HTMLElement, path: HTMLElement[] }) => {
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
        // 移动到弹窗的 loading 元素上，但经过 settimeout 后 loading 已经被移除了
        // https://ld246.com/article/1673596577519/comment/1673767749885#comments
        let targetElement = event.target;
        if (!targetElement.parentElement && event.path && event.path[1]) {
            targetElement = event.path[1];
        }
        const blockElement = hasClosestByClassName(targetElement, "block__popover", true);
        const maxEditLevels: { [key: string]: number } = {oid: 0};
        window.siyuan.blockPanels.forEach((item) => {
            if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "true") {
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
                if ((item.targetElement || typeof item.x === "number") &&
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
                if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "false" &&
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
    if (!popoverTargetElement && aElement && (
        (aElement.getAttribute("data-href")?.startsWith("siyuan://blocks") && aElement.getAttribute("prevent-popover") !== "true") ||
        (aElement.classList.contains("av__celltext") && aElement.dataset.type === "url"))) {
        popoverTargetElement = aElement;
    }
    if (!popoverTargetElement || window.siyuan.altIsPressed ||
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

export const showPopover = async (app: App, showRef = false) => {
    if (!popoverTargetElement) {
        return;
    }
    let ids: string[];
    let defIds: string[];
    const dataId = popoverTargetElement.getAttribute("data-id");
    if (dataId) {
        // backlink/util/hint/正文标题 上的弹层
        if (showRef) {
            const postResponse = await fetchSyncPost("/api/block/getRefIDs", {id: dataId});
            ids = postResponse.data.refIDs;
            defIds = postResponse.data.defIDs;
        } else {
            if (dataId.startsWith("[")) {
                ids = JSON.parse(dataId);
            } else {
                ids = [dataId];
            }
            defIds = JSON.parse(popoverTargetElement.getAttribute("data-defids") || "[]");
        }
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
        ids = [getIdFromSYProtocol(popoverTargetElement.getAttribute("data-href"))];
    } else if (popoverTargetElement.dataset.type === "url") {
        // 在 database 的 url 列中以思源协议开头的链接
        ids = [getIdFromSYProtocol(popoverTargetElement.textContent.trim())];
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
        if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "true"
            && JSON.stringify(ids) === JSON.stringify(item.nodeIds)) {
            hasPin = true;
            return true;
        }
    });
    if (!hasPin && popoverTargetElement.parentElement &&
        popoverTargetElement.parentElement.style.opacity !== "0.1" // 反向面板图标拖拽时不应该弹层
    ) {
        window.siyuan.blockPanels.push(new BlockPanel({
            app,
            targetElement: popoverTargetElement,
            isBacklink: showRef || popoverTargetElement.classList.contains("protyle-attr--refcount") || popoverTargetElement.classList.contains("counter"),
            nodeIds: ids,
            defIds,
        }));
    }
    // 不能清除，否则ctrl 后 shift 就 无效 popoverTargetElement = undefined;
};
