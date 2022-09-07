/// #if !MOBILE
import {getAllDocks} from "./getAll";
import {updateHotkeyTip} from "../protyle/util/compatibility";
import {exportLayout, getDockByType, resizeTabs} from "./util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {fetchPost} from "../util/fetch";
import {mountHelp} from "../util/mount";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
/// #endif

export const initStatus = () => {
    /// #if !MOBILE
    const allDocks = getAllDocks();
    let menuHTML = "";
    allDocks.forEach(item => {
        menuHTML += `<button class="b3-menu__item" data-type="${item.type}"><svg class="b3-menu__icon""><use xlink:href="#${item.icon}"></use></svg><span class="b3-menu__label">${window.siyuan.languages[item.hotkeyLangId]}</span><span class="b3-menu__accelerator">${updateHotkeyTip(window.siyuan.config.keymap.general[item.hotkeyLangId].custom)}</span></button>`;
    });
    document.getElementById("status").innerHTML = `<div id="barDock" class="toolbar__item b3-tooltips b3-tooltips__e${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.config.uiLayout.hideDock ? window.siyuan.languages.showDock : window.siyuan.languages.hideDock}">
    <svg>
        <use xlink:href="#${window.siyuan.config.uiLayout.hideDock ? "iconDock" : "iconHideDock"}"></use>
    </svg>
    <div class="b3-menu fn__none" style="bottom: 21px;left: 4px">
        ${menuHTML}
    </div>
</div>
<div class="status__msg"></div>
<div class="fn__flex-1"></div>
<div class="status__counter"></div>
<div id="barFeedback" class="toolbar__item b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.feedback}">
    <svg><use xlink:href="#iconHeart"></use></svg>
</div>
<div id="barLock" class="toolbar__item b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.lockScreen} ${updateHotkeyTip(window.siyuan.config.keymap.general.lockScreen.custom)}">
    <svg><use xlink:href="#iconLock"></use></svg>
</div>
<div id="barDebug" class="toolbar__item b3-tooltips b3-tooltips__nw fn__none" aria-label="${window.siyuan.languages.debug}">
    <svg>
        <use xlink:href="#iconBug"></use>
    </svg>
</div>
<div id="barHelp" class="toolbar__item b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.help}">
    <svg><use xlink:href="#iconHelp"></use></svg>
</div>`;
    const dockElement = document.getElementById("barDock");
    dockElement.addEventListener("mousemove", () => {
        dockElement.querySelector(".b3-menu").classList.remove("fn__none");
    });
    dockElement.addEventListener("mouseleave", () => {
        dockElement.querySelector(".b3-menu").classList.add("fn__none");
    });
    /// #if !BROWSER
    document.querySelector("#barDebug").classList.remove("fn__none");
    /// #endif
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
            } else if (target.id === "barLock") {
                exportLayout(false, () => {
                    fetchPost("/api/system/logoutAuth", {}, () => {
                        window.location.href = "/";
                    });
                });
                event.stopPropagation();
                break;
            } else if (target.id === "barHelp") {
                mountHelp();
                event.stopPropagation();
                break;
            } else if (target.id === "barDebug") {
                /// #if !BROWSER
                getCurrentWindow().webContents.openDevTools({mode: "bottom"});
                /// #endif
                event.stopPropagation();
                break;
            } else if (target.id === "barFeedback") {
                if ("zh_CN" === window.siyuan.config.lang) {
                    window.open("https://ld246.com/article/1649901726096");
                } else {
                    window.open("https://github.com/siyuan-note/siyuan/issues");
                }
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

export const countSelectWord = (range: Range) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    const selectText = range.toString();
    if (selectText) {
        fetchPost("/api/block/getContentWordCount", {"content": range.toString()}, (response) => {
            document.querySelector("#status .status__counter").innerHTML = `<span class="ft__on-surface">${window.siyuan.languages.runeCount}</span>
&nbsp;${response.data.runeCount}
<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.wordCount}</span>
&nbsp;${response.data.wordCount}<span class="fn__space"></span>`;
        });
    } else {
        document.querySelector("#status .status__counter").innerHTML = "";
    }
    /// #endif
};

export const countBlockWord = (ids: string[]) => {
    /// #if !MOBILE
    if (document.getElementById("status").classList.contains("fn__none")) {
        return;
    }
    if (ids.length > 0) {
        fetchPost("/api/block/getBlocksWordCount", {ids}, (response) => {
            document.querySelector("#status .status__counter").innerHTML = `<span class="ft__on-surface">${window.siyuan.languages.runeCount}</span>
&nbsp;${response.data.runeCount}
<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.wordCount}</span>
&nbsp;${response.data.wordCount}<span class="fn__space"></span>`;
        });
    } else {
        document.querySelector("#status .status__counter").innerHTML = "";
    }
    /// #endif
};

