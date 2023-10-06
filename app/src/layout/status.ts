/// #if !MOBILE
import {getDockByType} from "./util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {mountHelp} from "../util/mount";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
/// #endif
import {MenuItem} from "../menus/Menu";
import {Constants} from "../constants";
import {toggleDockBar} from "./dock/util";
import {updateHotkeyTip} from "../protyle/util/compatibility";

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
        let target = event.target as HTMLElement;
        while (target.id !== "status") {
            if (target.id === "barDock") {
                toggleDockBar(target.firstElementChild.firstElementChild);
                event.stopPropagation();
                break;
            } else if (target.classList.contains("status__backgroundtask")) {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === "statusBackgroundTask") {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", "statusBackgroundTask");
                JSON.parse(target.getAttribute("data-tasks")).forEach((item: { action: string }) => {
                    window.siyuan.menus.menu.append(new MenuItem({
                        type: "readonly",
                        iconHTML: Constants.ZWSP,
                        label: item.action
                    }).element);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.top}, true);
                event.stopPropagation();
                break;
            } else if (target.id === "statusHelp") {
                if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
                    window.siyuan.menus.menu.element.getAttribute("data-name") === "statusHelp") {
                    window.siyuan.menus.menu.remove();
                    return;
                }
                window.siyuan.menus.menu.remove();
                window.siyuan.menus.menu.element.setAttribute("data-name", "statusHelp");
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.help,
                    icon: "iconHelp",
                    click: () => {
                        mountHelp();
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.feedback,
                    icon: "iconFeedback",
                    click: () => {
                        if ("zh_CN" === window.siyuan.config.lang || "zh_CHT" === window.siyuan.config.lang) {
                            window.open("https://ld246.com/article/1649901726096");
                        } else {
                            window.open("https://liuyun.io/article/1686530886208");
                        }
                    }
                }).element);
                /// #if !BROWSER
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.debug,
                    icon: "iconBug",
                    click: () => {
                        getCurrentWindow().webContents.openDevTools({mode: "bottom"});
                    }
                }).element);
                /// #endif
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages["_trayMenu"].officialWebsite,
                    icon: "iconSiYuan",
                    click: () => {
                        window.open("https://b3log.org/siyuan");
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages["_trayMenu"].openSource,
                    icon: "iconGithub",
                    click: () => {
                        window.open("https://github.com/siyuan-note/siyuan");
                    }
                }).element);
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.top}, true);
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

let countRootId: string;
let countTimeout: number;
export const countSelectWord = (range: Range, rootID?: string) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    clearTimeout(countTimeout);
    countTimeout = window.setTimeout(() => {
        const selectText = range.toString();
        if (selectText) {
            fetchPost("/api/block/getContentWordCount", {"content": range.toString()}, (response) => {
                renderStatusbarCounter(response.data);
            });
            countRootId = "";
        } else if (rootID && rootID !== countRootId) {
            countRootId = rootID;
            fetchPost("/api/block/getTreeStat", {id: rootID}, (response) => {
                renderStatusbarCounter(response.data);
            });
        }
    }, Constants.TIMEOUT_COUNT);
    /// #endif
};

export const countBlockWord = (ids: string[], rootID?: string, clearCache = false) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    clearTimeout(countTimeout);
    countTimeout = window.setTimeout(() => {
        if (clearCache) {
            countRootId = "";
        }
        if (ids.length > 0) {
            fetchPost("/api/block/getBlocksWordCount", {ids}, (response) => {
                renderStatusbarCounter(response.data);
            });
            countRootId = "";
        } else if (rootID && rootID !== countRootId) {
            countRootId = rootID;
            fetchPost("/api/block/getTreeStat", {id: rootID}, (response) => {
                renderStatusbarCounter(response.data);
            });
        }
    }, Constants.TIMEOUT_COUNT);
    /// #endif
};

export const clearCounter = () => {
    countRootId = "";
    document.querySelector("#status .status__counter").innerHTML = "";
    clearTimeout(countTimeout);
};

export const renderStatusbarCounter = (stat: {
    runeCount: number,
    wordCount: number,
    linkCount: number,
    imageCount: number,
    refCount: number
}) => {
    let html = `<span class="ft__on-surface">${window.siyuan.languages.runeCount}</span>&nbsp;${stat.runeCount}<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.wordCount}</span>&nbsp;${stat.wordCount}<span class="fn__space"></span>`;
    if (0 < stat.linkCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.linkCount}</span>&nbsp;${stat.linkCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.imageCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.imgCount}</span>&nbsp;${stat.imageCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.refCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.refCount}</span>&nbsp;${stat.refCount}<span class="fn__space"></span>`;
    }
    document.querySelector("#status .status__counter").innerHTML = html;
};
