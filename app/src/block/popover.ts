import {BlockPanel} from "./Panel";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName,} from "../protyle/util/hasClosest";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {hideTooltip, showTooltip} from "../dialog/tooltip";
import {getIdFromSYProtocol, isLocalPath} from "../util/pathName";
import {App} from "../index";
import {Constants} from "../constants";
import {getCellText} from "../protyle/render/av/cell";

let popoverTargetElement: HTMLElement;
export const initBlockPopover = (app: App) => {
    let timeout: number;
    let timeoutHide: number;
    // 编辑器内容块引用/backlinks/tag/bookmark/套娃中使用
    document.addEventListener("mouseover", (event: MouseEvent & { target: HTMLElement, path: HTMLElement[] }) => {
        if (!window.siyuan.config || !window.siyuan.menus) {
            return;
        }
        const aElement = hasClosestByAttribute(event.target, "data-type", "a", true) ||
            hasClosestByClassName(event.target, "ariaLabel") ||
            hasClosestByAttribute(event.target, "data-type", "tab-header") ||
            hasClosestByAttribute(event.target, "data-type", "inline-memo") ||
            hasClosestByClassName(event.target, "av__cell");
        if (aElement) {
            let tip = aElement.getAttribute("aria-label") || aElement.getAttribute("data-inline-memo-content");
            if (aElement.classList.contains("av__cell")) {
                if (aElement.classList.contains("av__cell--header")) {
                    const textElement = aElement.querySelector(".av__celltext");
                    if (textElement.scrollWidth > textElement.clientWidth + 2) {
                        tip = getCellText(aElement);
                    }
                } else {
                    if (aElement.firstElementChild?.getAttribute("data-type") === "url") {
                        if (aElement.firstElementChild.textContent.indexOf("...") > -1) {
                            tip = Lute.EscapeHTMLStr(aElement.firstElementChild.getAttribute("data-href"));
                        }
                    }
                    if (!tip && aElement.dataset.wrap !== "true" && event.target.dataset.type !== "block-more" && !hasClosestByClassName(event.target, "block__icon")) {
                        aElement.style.overflow = "auto";
                        if (aElement.scrollWidth > aElement.clientWidth + 2) {
                            tip = Lute.EscapeHTMLStr(getCellText(aElement));
                        }
                        aElement.style.overflow = "";
                    }
                }
            }
            if (!tip) {
                const href = aElement.getAttribute("data-href") || "";
                // 链接地址强制换行 https://github.com/siyuan-note/siyuan/issues/11539
                if (href) {
                    tip = `<span style="word-break: break-all">${href.substring(0, Constants.SIZE_TITLE)}</span>`;
                }
                const title = aElement.getAttribute("data-title");
                if (tip && isLocalPath(href) && !aElement.classList.contains("b3-tooltips")) {
                    let assetTip = tip;
                    fetchPost("/api/asset/statAsset", {path: href}, (response) => {
                        if (response.code === 1) {
                            if (title) {
                                assetTip += "<br>" + title;
                            }
                        } else {
                            assetTip += ` ${response.data.hSize}${title ? "<br>" + title : ""}<br>${window.siyuan.languages.modifiedAt} ${response.data.hCreated}<br>${window.siyuan.languages.createdAt} ${response.data.hUpdated}`;
                        }
                        showTooltip(assetTip, aElement);
                    });
                    tip = "";
                } else if (title) {
                    tip += "<br>" + title;
                }
            }
            if (tip && !aElement.classList.contains("b3-tooltips")) {
                // https://github.com/siyuan-note/siyuan/issues/11294
                try {
                    showTooltip(decodeURIComponent(tip), aElement);
                } catch (e) {
                    // https://ld246.com/article/1718235737991
                    showTooltip(tip, aElement);
                }
                event.stopPropagation();
            } else {
                hideTooltip();
            }
        } else if (!aElement) {
            const tipElement = hasClosestByAttribute(event.target, "id", "tooltip", true);
            if (!tipElement || (
                tipElement && (tipElement.clientHeight >= tipElement.scrollHeight && tipElement.clientWidth >= tipElement.scrollWidth)
            )) {
                hideTooltip();
            }
        }
        if (window.siyuan.config.editor.floatWindowMode === 1 || window.siyuan.shiftIsPressed) {
            clearTimeout(timeoutHide);
            timeoutHide = window.setTimeout(() => {
                hidePopover(event);
            }, Constants.TIMEOUT_INPUT);

            if (!getTarget(event, aElement)) {
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/9007
            if (event.relatedTarget && !document.contains(event.relatedTarget as Node)) {
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
        }, Constants.TIMEOUT_INPUT);
        timeout = window.setTimeout(() => {
            if (!getTarget(event, aElement)) {
                return;
            }
            clearTimeout(timeoutHide);
            showPopover(app);
        }, 620);
    });
};

const hidePopover = (event: MouseEvent & { path: HTMLElement[] }) => {
    // pad 端点击后 event.target 不会更新。
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target) {
        return false;
    }
    if ((target.id && target.tagName !== "svg" && (target.id.startsWith("minder_node") || target.id.startsWith("kity_") || target.id.startsWith("node_")))
        || target.classList.contains("counter")
        || target.tagName === "circle"
    ) {
        // gutter & mindmap & 文件树上的数字 & 关系图节点不处理
        return false;
    }

    const avPanelElement = hasClosestByClassName(target, "av__panel") || hasClosestByClassName(target, "av__mask");
    if (avPanelElement) {
        // 浮窗上点击 av 操作，浮窗不能消失
        const blockPanel = window.siyuan.blockPanels.find((item) => {
            if (item.element.style.zIndex < avPanelElement.style.zIndex) {
                return true;
            }
        });
        if (blockPanel) {
            return false;
        }
    } else {
        // 浮窗上点击菜单，浮窗不能消失 https://ld246.com/article/1632668091023
        const menuElement = hasClosestByClassName(target, "b3-menu");
        if (menuElement) {
            const blockPanel = window.siyuan.blockPanels.find((item) => {
                if (item.element.style.zIndex < menuElement.style.zIndex) {
                    return true;
                }
            });
            if (blockPanel) {
                return false;
            }
        }
    }
    popoverTargetElement = hasClosestByAttribute(target, "data-type", "block-ref") as HTMLElement ||
        hasClosestByAttribute(target, "data-type", "virtual-block-ref") as HTMLElement;
    if (popoverTargetElement && popoverTargetElement.classList.contains("b3-tooltips")) {
        popoverTargetElement = undefined;
    }
    if (!popoverTargetElement) {
        popoverTargetElement = hasClosestByClassName(target, "popover__block") as HTMLElement;
    }
    const linkElement = hasClosestByAttribute(target, "data-type", "a", true);
    if (!popoverTargetElement && linkElement && linkElement.getAttribute("data-href")?.startsWith("siyuan://blocks")) {
        popoverTargetElement = linkElement;
    }
    if (!popoverTargetElement || (popoverTargetElement && window.siyuan.menus.menu.data?.isSameNode(popoverTargetElement))) {
        // 移动到弹窗的 loading 元素上，但经过 settimeout 后 loading 已经被移除了
        // https://ld246.com/article/1673596577519/comment/1673767749885#comments
        let targetElement = target;
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
        const menuLevel = parseInt(window.siyuan.menus.menu.element.dataset.from);
        if (blockElement) {
            for (let i = window.siyuan.blockPanels.length - 1; i >= 0; i--) {
                const item = window.siyuan.blockPanels[i];
                const itemLevel = parseInt(item.element.getAttribute("data-level"));
                if ((item.targetElement || typeof item.x === "number") &&
                    itemLevel > (maxEditLevels[item.element.getAttribute("data-oid")] || 0) &&
                    item.element.getAttribute("data-pin") === "false" &&
                    itemLevel > parseInt(blockElement.getAttribute("data-level"))) {
                    if (menuLevel && menuLevel >= itemLevel) {
                        // 有 gutter 菜单时不隐藏
                    } else {
                        item.destroy();
                    }
                }
            }
        } else {
            for (let i = window.siyuan.blockPanels.length - 1; i >= 0; i--) {
                const item = window.siyuan.blockPanels[i];
                const itemLevel = parseInt(item.element.getAttribute("data-level"));
                if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "false") {
                    if (menuLevel && menuLevel >= itemLevel) {
                        // 有 gutter 菜单时不隐藏
                    } else {
                        item.destroy();
                    }
                }
            }
        }
    }
};

const getTarget = (event: MouseEvent & { target: HTMLElement }, aElement: false | HTMLElement) => {
    if (window.siyuan.config.editor.floatWindowMode === 2 || hasClosestByClassName(event.target, "history__repo", true)) {
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
    if (!popoverTargetElement && aElement) {
        if (aElement.getAttribute("data-href")?.startsWith("siyuan://blocks") && aElement.getAttribute("prevent-popover") !== "true") {
            popoverTargetElement = aElement;
        } else if (aElement.classList.contains("av__cell")) {
            const textElement = aElement.querySelector(".av__celltext--url") as HTMLElement;
            if (textElement && textElement.dataset.type === "url" && textElement.dataset.href?.startsWith("siyuan://blocks")) {
                popoverTargetElement = textElement;
            }
        }
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
    if (!popoverTargetElement || window.siyuan.menus.menu.data?.isSameNode(popoverTargetElement)) {
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
    } else if (popoverTargetElement.dataset.popoverUrl) {
        // 镜像数据库
        const postResponse = await fetchSyncPost(popoverTargetElement.dataset.popoverUrl, {avID: popoverTargetElement.dataset.avId});
        ids = postResponse.data;
    } else {
        // pdf
        let targetId;
        let url = "/api/block/getRefIDs";
        if (popoverTargetElement.classList.contains("protyle-attr--refcount")) {
            // 编辑器中的引用数
            targetId = popoverTargetElement.parentElement.parentElement.getAttribute("data-node-id");
        } else if (popoverTargetElement.classList.contains("pdf__rect")) {
            const relationIds = popoverTargetElement.getAttribute("data-relations");
            if (relationIds) {
                ids = relationIds.split(",");
                url = "";
            } else {
                targetId = popoverTargetElement.getAttribute("data-node-id");
                url = "/api/block/getRefIDsByFileAnnotationID";
            }
        } else if (!targetId) {
            // 文件树中的引用数
            targetId = popoverTargetElement.parentElement.getAttribute("data-node-id");
        }
        if (url) {
            const postResponse = await fetchSyncPost(url, {id: targetId});
            ids = postResponse.data.refIDs;
            defIds = postResponse.data.defIDs;
        }
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
