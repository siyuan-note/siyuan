/// #if !MOBILE
import {getAllDocks} from "./getAll";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {getDockByType, resizeTabs} from "./util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {mountHelp} from "../util/mount";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
/// #endif
import {MenuItem} from "../menus/Menu";
import {Constants} from "../constants";

export const initStatus = (isWindow = false) => {
    /// #if !MOBILE
    const allDocks = getAllDocks();
    let menuHTML = "";
    allDocks.forEach(item => {
        menuHTML += `<button class="b3-menu__item" data-type="${item.type}"><svg class="b3-menu__icon""><use xlink:href="#${item.icon}"></use></svg><span class="b3-menu__label">${window.siyuan.languages[item.hotkeyLangId]}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.general[item.hotkeyLangId].custom)}</span></button>`;
    });
    let barDockHTML = "";
    if (!isWindow) {
        barDockHTML = `<div id="barDock" class="toolbar__item b3-tooltips b3-tooltips__e${window.siyuan.config.readonly || isWindow ? " fn__none" : ""}" aria-label="${window.siyuan.config.uiLayout.hideDock ? window.siyuan.languages.showDock : window.siyuan.languages.hideDock}">
    <svg>
        <use xlink:href="#${window.siyuan.config.uiLayout.hideDock ? "iconDock" : "iconHideDock"}"></use>
    </svg>
    <div class="b3-menu fn__none" style="bottom: 32px;left: 5px">
        ${menuHTML}
    </div>
</div>`;
    }
    document.getElementById("status").innerHTML = `${barDockHTML}
<div class="status__msg"></div>
<div class="fn__flex-1"></div>
<div class="status__backgroundtask fn__none"></div>
<div class="status__counter"></div>
<div id="statusHelp" class="toolbar__item b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.help}">
    <svg><use xlink:href="#iconHelp"></use></svg>
</div>`;

    document.querySelector("#status").addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target.id !== "status") {
            if (target.id === "barDock") {
                const useElement = target.firstElementChild.firstElementChild;
                const dockIsShow = useElement.getAttribute("xlink:href") === "#iconHideDock";
                if (dockIsShow) {
                    useElement.setAttribute("xlink:href", "#iconDock");
                    target.setAttribute("aria-label", window.siyuan.languages.showDock);
                } else {
                    useElement.setAttribute("xlink:href", "#iconHideDock");
                    target.setAttribute("aria-label", window.siyuan.languages.hideDock);
                }
                document.querySelectorAll(".dock").forEach(item => {
                    if (dockIsShow) {
                        if (item.querySelector(".dock__item")) {
                            item.classList.add("fn__none");
                        }
                    } else {
                        if (item.querySelector(".dock__item")) {
                            item.classList.remove("fn__none");
                        }
                    }
                });
                resizeTabs();
                target.querySelector(".b3-menu").classList.add("fn__none");
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
                    icon: "iconHeart",
                    click: () => {
                        if ("zh_CN" === window.siyuan.config.lang) {
                            window.open("https://ld246.com/article/1649901726096");
                        } else {
                            window.open("https://github.com/siyuan-note/siyuan/issues");
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
                const type = target.getAttribute("data-type") as TDockType;
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
export const countSelectWord = (range: Range, rootID?: string) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
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
    /// #endif
};

export const countBlockWord = (ids: string[], rootID?: string, clearCache = false) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
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
    /// #endif
};

export const clearCounter = () => {
    countRootId = "";
    document.querySelector("#status .status__counter").innerHTML = "";
};

export const renderStatusbarCounter = (stat: { runeCount: number, wordCount: number, linkCount: number, imageCount: number, refCount: number }) => {
    let html = `<span class="ft__on-surface">${window.siyuan.languages.runeCount}</span>&nbsp;${stat.runeCount}<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.wordCount}</span>&nbsp;${stat.wordCount}<span class="fn__space"></span>`;
    if (0 < stat.linkCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.link}</span>&nbsp;${stat.linkCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.imageCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.image}</span>&nbsp;${stat.imageCount}<span class="fn__space"></span>`;
    }
    if (0 < stat.refCount) {
        html += `<span class="ft__on-surface">${window.siyuan.languages.ref}</span>&nbsp;${stat.refCount}<span class="fn__space"></span>`;
    }
    document.querySelector("#status .status__counter").innerHTML = html;
};
