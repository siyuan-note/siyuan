/// #if !MOBILE
import {getDockByType} from "./tabUtil";
import {toggleDockBar} from "./dock/util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {mountHelp} from "../util/mount";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
/// #endif
import {MenuItem} from "../menus/Menu";
import {Constants} from "../constants";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {escapeAriaLabel} from "../util/escape";
import {openLink} from "../editor/openLink";
import {waitForPendingTransactions} from "../protyle/util/transactionQueue";

export const initStatus = (isWindow = false) => {
    /// #if !MOBILE
    let barDockHTML = "";
    if (!isWindow) {
        barDockHTML = `<div id="barDock" class="toolbar__item ariaLabel${window.siyuan.config.readonly || isWindow ? " fn__none" : ""}" aria-label="${window.siyuan.languages.toggleDock} ${updateHotkeyTip(window.siyuan.config.keymap.general.toggleDock.custom)}">
    <svg>
        <use xlink:href="#${window.siyuan.config.uiLayout.hideDock ? "iconDock" : "iconHideDock"}"></use>
    </svg>
</div>`;
    }
    document.getElementById("status").innerHTML = `${barDockHTML}
<div class="status__msg"></div>
<div class="fn__flex-1"></div>
<div class="status__backgroundtask fn__none"></div>
<div class="status__counter"></div>
<div id="statusHelp" class="toolbar__item ariaLabel" aria-label="${window.siyuan.languages.help}">
    <svg><use xlink:href="#iconHelp"></use></svg>
</div>`;
    document.querySelector("#status").addEventListener("click", (event) => {
        let target = event.target as HTMLElement | null;
        while (target && target.id !== "status") {
            if (target.id === "barDock") {
                toggleDockBar(target.firstElementChild.firstElementChild);
                event.stopPropagation();
                break;
            } else if (target.classList.contains("status__backgroundtask")) {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_STATUS_BACKGROUND_TASK) {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_STATUS_BACKGROUND_TASK);
                JSON.parse(target.getAttribute("data-tasks")).forEach((item: { action: string }) => {
                    window.siyuan.menus.menu.append(new MenuItem({
                        type: "readonly",
                        iconHTML: "",
                        label: item.action
                    }).element);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.top, isLeft: true});
                event.stopPropagation();
                break;
            } else if (target.id === "statusHelp") {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_STATUS_HELP) {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_STATUS_HELP);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.userGuide,
                    icon: "iconHelp",
                    ignore: window.siyuan.config.readonly,
                    click: () => {
                        mountHelp();
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.feedback,
                    icon: "iconFeedback",
                    click: () => {
                        if ("zh-CN" === window.siyuan.config.lang) {
                            openLink(window.siyuan.ws.app, "https://ld246.com/article/1649901726096");
                        } else {
                            openLink(window.siyuan.ws.app, "https://liuyun.io/article/1686530886208");
                        }
                    }
                }).element);
                /// #if !BROWSER
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.debug,
                    icon: "iconBug",
                    click: () => {
                        ipcRenderer.send(Constants.SIYUAN_CMD, "toggleDevTools");
                    }
                }).element);
                /// #endif
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages["_trayMenu"].officialWebsite,
                    icon: "iconSiYuan",
                    click: () => {
                        openLink(window.siyuan.ws.app, "https://b3log.org/siyuan");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages["_trayMenu"].openSource,
                    icon: "iconGithub",
                    click: () => {
                        openLink(window.siyuan.ws.app, "https://github.com/siyuan-note/siyuan");
                    }
                }).element);
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.top, isLeft: true});
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-menu__item")) {
                const type = target.getAttribute("data-type");
                getDockByType(type).toggleModel(type);
                if (type === "file" && getSelection().rangeCount > 0) {
                    const range = getSelection().getRangeAt(0);
                    const wysiwygElement = hasClosestByClassName(range.startContainer, "protyle-wysiwyg", true);
                    if (wysiwygElement) {
                        wysiwygElement.blur();
                    }
                }
                target.parentElement.classList.add("fn__none");
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    if (window.siyuan.config.appearance.hideStatusBar) {
        document.getElementById("status").classList.add("fn__none");
    }
    /// #endif
};

let countTimeout: number;
let countAbortController: AbortController | null = null;
let lastRootId: string;

const scheduleStatusStat = (rootID: string, content?: string, ids?: string[], protyle?: IProtyle) => {
    clearTimeout(countTimeout);
    if (countAbortController) {
        countAbortController.abort();
        countAbortController = null;
    }
    countTimeout = window.setTimeout(async () => {
        countAbortController = new AbortController();
        const signal = countAbortController.signal;
        const capturedController = countAbortController;

        const finishRequest = () => {
            if (countAbortController === capturedController) {
                countAbortController = null;
            }
        };
        const onFetched = (response: IWebSocketData) => {
            if (signal.aborted) {
                return;
            }
            if (response.code !== 0 || !response.data?.stat) {
                finishRequest();
                return;
            }
            renderStatusbarCounter(response.data.stat);
            finishRequest();
        };

        if (!content && protyle) {
            await waitForPendingTransactions(protyle);
            if (signal.aborted || rootID !== protyle.block.rootID) {
                finishRequest();
                return;
            }
        }
        if (content) {
            fetchPost("/api/block/getContentWordCount", {content}, onFetched, undefined, undefined, signal);
            lastRootId = null;
        } else if (ids && ids.length > 0) {
            fetchPost("/api/block/getBlocksWordCount", {ids}, onFetched, undefined, undefined, signal);
            lastRootId = null;
        } else if (rootID && lastRootId !== rootID) {
            lastRootId = rootID;
            fetchPost("/api/block/getTreeStat", {id: rootID}, (response) => {
                if (signal.aborted) {
                    return;
                }
                if (response.code !== 0 || !response.data?.stat) {
                    lastRootId = null;
                    finishRequest();
                    return;
                }
                renderStatusbarCounter(response.data.stat);
                if (!response.data.containsEmbed) {
                    finishRequest();
                    return;
                }
                fetchPost("/api/block/getTreeStat", {id: rootID, includeEmbed: true}, (embedResponse) => {
                    if (signal.aborted) {
                        return;
                    }
                    if (embedResponse.code !== 0 || !embedResponse.data?.stat) {
                        lastRootId = null;
                        finishRequest();
                        return;
                    }
                    renderStatusbarCounter(
                        embedResponse.data.stat,
                        embedResponse.data.statWithEmbed,
                        embedResponse.data.embedStat
                    );
                    finishRequest();
                }, undefined, undefined, signal);
            }, undefined, undefined, signal);
        } else {
            lastRootId = null;
            finishRequest();
        }
    }, Constants.TIMEOUT_COUNT);
};

export const countSelectWord = (range: Range, context?: string | IProtyle) => {
    /// #if !MOBILE
    if (typeof context === "object" && context.lite) {
        return;
    }
    const rootID = typeof context === "object" ? context.block.rootID : context;
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    scheduleStatusStat(rootID, range.toString());
    /// #endif
};

export const countBlockWord = (ids: string[], context?: string | IProtyle, clearCache = false) => {
    /// #if !MOBILE
    if (typeof context === "object" && context.lite) {
        return;
    }
    const rootID = typeof context === "object" ? context.block.rootID : context;
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    if (clearCache) {
        lastRootId = null;
    }
    if (ids.length > 0) {
        scheduleStatusStat(rootID, undefined, ids, typeof context === "object" ? context : undefined);
        return;
    }
    const selectText = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0).toString() : "";
    if (selectText) {
        scheduleStatusStat(rootID, selectText);
        return;
    }
    scheduleStatusStat(rootID, undefined, undefined, typeof context === "object" ? context : undefined);
    /// #endif
};

export const clearCounter = () => {
    lastRootId = null;
    clearTimeout(countTimeout);
    if (countAbortController) {
        countAbortController.abort();
        countAbortController = null;
    }
    document.querySelector("#status .status__counter").innerHTML = "";
};

export interface IBlockStat {
    runeCount: number;
    wordCount: number;
    linkCount: number;
    imageCount: number;
    refCount: number;
    blockCount: number;
}

export interface IEmbedStat {
    complete: boolean;
    queryEmbedCount: number;
    jsEmbedCount: number;
    resultCount: number;
    failedQueryCount: number;
    failedResultCount: number;
    truncatedQueryCount: number;
    cycleCount: number;
    depthLimitCount: number;
}

export const genEmbedStatTip = (label: string, value: number, embedStat?: IEmbedStat) => {
    const prefix = embedStat && !embedStat.complete ? "≈" : "";
    const incompleteTip = embedStat && !embedStat.complete ? ` ${window.siyuan.languages.embedStatIncomplete}` : "";
    return `${prefix}${label} ${value}${incompleteTip}`;
};

export const renderStatusbarCounter = (stat: IBlockStat, statWithEmbed?: IBlockStat, embedStat?: IEmbedStat) => {
    if (!stat) {
        return;
    }
    const runeEmbedAttrs = statWithEmbed ? ` class="ft__on-surface ariaLabel" data-position="north" aria-label="${escapeAriaLabel(genEmbedStatTip(window.siyuan.languages.runeCountWithEmbed, statWithEmbed.runeCount, embedStat))}"` : " class=\"ft__on-surface\"";
    const wordEmbedAttrs = statWithEmbed ? ` class="ft__on-surface ariaLabel" data-position="north" aria-label="${escapeAriaLabel(genEmbedStatTip(window.siyuan.languages.wordCountWithEmbed, statWithEmbed.wordCount, embedStat))}"` : " class=\"ft__on-surface\"";
    let html = `<span${runeEmbedAttrs}>${window.siyuan.languages.runeCount}</span>&nbsp;${stat.runeCount}<span class="fn__space"></span>
<span${wordEmbedAttrs}>${window.siyuan.languages.wordCount}</span>&nbsp;${stat.wordCount}<span class="fn__space"></span>`;
    if (0 < stat.linkCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.linkCount}</span>&nbsp;${stat.linkCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.imageCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.imgCount}</span>&nbsp;${stat.imageCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.refCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.refCount}</span>&nbsp;${stat.refCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.blockCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.blockCount}</span>&nbsp;${stat.blockCount}<span class="fn__space"></span>`;
    }
    document.querySelector("#status .status__counter").innerHTML = html;
};
