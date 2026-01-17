import * as path from "path";
import {fetchPost} from "./fetch";
import {Dialog} from "../dialog";
import {escapeHtml} from "./escape";
import {getSearch, isMobile} from "./functions";
import {focusByRange} from "../protyle/util/selection";
import {unicode2Emoji} from "../emoji";
import {Constants} from "../constants";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {showMessage} from "../dialog/message";
import {isOnlyMeta, isWindows, setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {matchHotKey} from "../protyle/util/hotKey";
import {Menu} from "../plugin/Menu";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

export const useShell = (cmd: "showItemInFolder" | "openPath", filePath: string) => {
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_CMD, {
        cmd,
        filePath: filePath
    });
    /// #endif
};

export const getIdZoomInByPath = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const PWAURL = searchParams.get("url");
    const data = {
        id: "",
        isZoomIn: false,
    };
    if (/^web\+siyuan:\/\/blocks\/\d{14}-\w{7}/.test(PWAURL)) {
        // PWA 捕获 web+siyuan://blocks/20221031001313-rk7sd0e?focus=1
        data.id = PWAURL.substring(20, 20 + 22);
        data.isZoomIn = getSearch("focus", PWAURL) === "1";
        window.siyuan.editorIsFullscreen = getSearch("fullscreen", PWAURL) === "1";
    } else if (window.JSAndroid) {
        // PAD 通过思源协议打开
        const SYURL = window.JSAndroid.getBlockURL();
        data.id = getIdFromSYProtocol(SYURL);
        data.isZoomIn = getSearch("focus", SYURL) === "1";
        window.siyuan.editorIsFullscreen = getSearch("fullscreen", SYURL) === "1";
    } else {
        // 支持通过 URL 查询字符串参数 `id` 和 `focus` 跳转到 Web 端指定块 https://github.com/siyuan-note/siyuan/pull/7086
        data.id = searchParams.get("id");
        data.isZoomIn = searchParams.get("focus") === "1";
        window.siyuan.editorIsFullscreen = searchParams.get("fullscreen") === "1";
    }
    return data;
};

export const isSYProtocol = (url: string) => {
    return /^siyuan:\/\/blocks\/\d{14}-\w{7}/.test(url);
};

export const getIdFromSYProtocol = (url: string) => {
    return url.substring(16, 16 + 22);
};

/* redirect to auth page */
export const redirectToCheckAuth = (to: string = window.location.href) => {
    const url = new URL(window.location.origin);
    url.pathname = "/check-auth";
    url.searchParams.set("to", to);
    window.location.href = url.href;
};

export const addBaseURL = () => {
    let baseURLElement = document.getElementById("baseURL");
    if (!baseURLElement) {
        baseURLElement = document.createElement("base");
        baseURLElement.id = "baseURL";
    }
    baseURLElement.setAttribute("href", location.origin);
    document.getElementsByTagName("head")[0].appendChild(baseURLElement);
};

export const getDisplayName = (filePath: string, basename = true, removeSY = false) => {
    let name = filePath;
    if (basename) {
        name = pathPosix().basename(filePath);
    }
    if (removeSY && name.endsWith(".sy")) {
        name = name.substr(0, name.length - 3);
    }
    return name;
};

export const getAssetName = (assetPath: string) => {
    return pathPosix().basename(assetPath, pathPosix().extname(assetPath)).replace(/-\d{14}-\w{7}/, "");
};

export const isLocalPath = (link: string) => {
    if (!link) {
        return false;
    }

    link = link.trim();
    if (1 > link.length) {
        return false;
    }

    link = link.toLowerCase();
    if (link.startsWith("assets/") || link.startsWith("file://") || link.startsWith("\\\\") /* Windows 网络共享路径 */) {
        return true;
    }

    if (isWindows()) {
        const colonIdx = link.indexOf(":");
        return 1 === colonIdx; // 冒号前面只有一个字符认为是 Windows 盘符而不是网络协议
    }
    return link.startsWith("/");
};

export const pathPosix = () => {
    if (path.posix) {
        return path.posix;
    }
    return path;
};

export const originalPath = () => {
    return path;
};

export const getTopPaths = (liElements: Element[]) => {
    const fromPaths: string[] = [];
    liElements.forEach((item: HTMLElement) => {
        if (item.getAttribute("data-type") !== "navigation-root") {
            const dataPath = item.getAttribute("data-path");
            const isChild = fromPaths.find(item => {
                if (dataPath.startsWith(item.replace(".sy", ""))) {
                    return true;
                }
            });
            if (!isChild) {
                fromPaths.push(dataPath);
            }
        }
    });
    return fromPaths;
};

export const moveToPath = (fromPaths: string[], toNotebook: string, toPath: string) => {
    fetchPost("/api/filetree/moveDocs", {
        toNotebook,
        fromPaths,
        toPath,
    });
};

export const movePathTo = (options: {
    cb: (toPath: string[], toNotebook: string[]) => void,
    paths?: string[],
    range?: Range,
    title?: string,
    flashcard: boolean
    rootIDs?: string[],
}) => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#foldList")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return;
    }
    const dialog = new Dialog({
        title: `<div style="padding: 8px;">
    ${options.title || window.siyuan.languages.move}
    <div style="max-height: 16px;line-height: 14px;-webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0) 0, #000 6px);padding-bottom: 4px;margin-bottom: -4px" class="ft__smaller ft__on-surface fn__hidescrollbar"></div>
</div>`,
        content: `<div class="b3-form__icon" style="margin: 8px">
    <span data-menu="true" class="b3-form__icon-list fn__a b3-tooltips b3-tooltips__s" aria-label="${updateHotkeyTip("⌥↓")}">
        <svg class="svg--mid"><use xlink:href="#iconSearch"></use></svg>
        <svg class="svg--smaller"><use xlink:href="#iconDown"></use></svg>
    </span>
    <input class="b3-text-field fn__block" style="padding-left: 42px;" value="" placeholder="${window.siyuan.languages.search}">
</div>
<ul id="foldList" class="fn__flex-1 fn__none b3-list b3-list--background${isMobile() ? " b3-list--mobile" : ""}" style="overflow: auto;position: relative"></ul>
<div id="foldTree" class="fn__flex-1${isMobile() ? " b3-list--mobile" : ""}" style="overflow: auto;position: relative"></div>
<div class="fn__hr"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "50vw",
        height: isMobile() ? "80vh" : "70vh",
        destroyCallback() {
            if (options.range) {
                focusByRange(options.range);
            }
        }
    });
    dialog.element.querySelector(".b3-dialog__header").setAttribute("style", "padding:0");
    dialog.element.setAttribute("data-key", Constants.DIALOG_MOVEPATHTO);
    if (options.paths && options.paths.length > 0) {
        fetchPost("/api/filetree/getHPathsByPaths", {paths: options.paths}, (response) => {
            dialog.element.querySelector(".b3-dialog__header .ft__smaller").innerHTML = escapeHtml(response.data.join(" "));
        });
    }
    const searchListElement = dialog.element.querySelector("#foldList");
    const searchTreeElement = dialog.element.querySelector("#foldTree");
    setNoteBook((notebooks) => {
        let html = "";
        notebooks.forEach((item) => {
            if (!item.closed) {
                let countHTML = "";
                if (options.flashcard) {
                    countHTML = `<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardNewCard}">${item.newFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDueCard}">${item.dueFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardCard}">${item.flashcardCount}</span>`;
                }
                html += `<ul class="b3-list b3-list--background">
<li class="b3-list-item${html === "" ? " b3-list-item--focus" : ""}" data-path="/" data-box="${item.id}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].note, "b3-list-item__graphic", true)}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    ${countHTML}
</li></ul>`;
            }
        });
        searchTreeElement.innerHTML = html;
    }, options.flashcard);

    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.value = window.siyuan.storage[Constants.LOCAL_MOVE_PATH].k;
    /// #if !MOBILE
    inputElement.select();
    /// #endif
    const inputEvent = (event?: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        if (inputElement.value.trim() === "") {
            searchListElement.classList.add("fn__none");
            searchTreeElement.classList.remove("fn__none");
            return;
        }
        searchTreeElement.classList.add("fn__none");
        searchListElement.classList.remove("fn__none");
        searchListElement.scrollTo(0, 0);
        fetchPost("/api/filetree/searchDocs", {
            k: inputElement.value,
            flashcard: options.flashcard,
            excludeIDs: options.rootIDs,
        }, (data) => {
            let fileHTML = "";
            data.data.forEach((item: {
                boxIcon: string,
                box: string,
                hPath: string,
                path: string,
                newFlashcardCount: string,
                dueFlashcardCount: string,
                flashcardCount: string
            }) => {
                let countHTML = "";
                if (options.flashcard) {
                    countHTML = `<span class="fn__flex-1"></span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardNewCard}">${item.newFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDueCard}">${item.dueFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardCard}">${item.flashcardCount}</span>`;
                }
                fileHTML += `<li class="b3-list-item${fileHTML === "" ? " b3-list-item--focus" : ""}" data-path="${item.path}" data-box="${item.box}">
    ${unicode2Emoji(item.boxIcon || window.siyuan.storage[Constants.LOCAL_IMAGES].note, "b3-list-item__graphic", true)}
    <span class="b3-list-item__showall" style="padding: 4px 0">${escapeHtml(item.hPath)}</span>
    ${countHTML}
</li>`;
            });
            searchListElement.innerHTML = fileHTML;
        });
    };

    const toggleMovePathHistory = () => {
        const keys = window.siyuan.storage[Constants.LOCAL_MOVE_PATH].keys;
        if (!keys || keys.length === 0 || (keys.length === 1 && keys[0] === inputElement.value)) {
            return;
        }
        const menu = new Menu(Constants.MENU_MOVE_PATH_HISTORY);
        if (menu.isOpen) {
            return;
        }
        menu.element.classList.add("b3-menu--list");
        menu.addItem({
            iconHTML: "",
            label: window.siyuan.languages.clearHistory,
            click() {
                window.siyuan.storage[Constants.LOCAL_MOVE_PATH].keys = [];
                setStorageVal(Constants.LOCAL_MOVE_PATH, window.siyuan.storage[Constants.LOCAL_MOVE_PATH]);
            }
        });
        const separatorElement = menu.addSeparator(1);
        let current = true;
        keys.forEach((s: string) => {
            if (s !== inputElement.value && s) {
                const menuItem = menu.addItem({
                    iconHTML: "",
                    label: escapeHtml(s),
                    action: "iconCloseRound",
                    bind(element) {
                        element.addEventListener("click", (itemEvent) => {
                            if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                                keys.find((item: string, index: number) => {
                                    if (item === s) {
                                        keys.splice(index, 1);
                                        return true;
                                    }
                                });
                                window.siyuan.storage[Constants.LOCAL_MOVE_PATH].keys = keys;
                                setStorageVal(Constants.LOCAL_MOVE_PATH, window.siyuan.storage[Constants.LOCAL_MOVE_PATH]);
                                if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                    window.siyuan.menus.menu.remove();
                                } else {
                                    element.remove();
                                }
                            } else {
                                inputElement.value = element.textContent;
                                inputEvent();
                                window.siyuan.menus.menu.remove();
                            }
                            itemEvent.preventDefault();
                            itemEvent.stopPropagation();
                        });
                    }
                });
                if (current) {
                    menuItem.classList.add("b3-menu__item--current");
                }
                current = false;
            }
        });
        if (current) {
            separatorElement.remove();
        }
        const rect = inputElement.getBoundingClientRect();
        menu.open({
            x: rect.left,
            y: rect.bottom
        });
    };
    inputEvent();
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        inputEvent(event);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        inputEvent(event);
    });
    inputElement.addEventListener("blur", () => {
        if (inputElement.value) {
            let list: string[] = window.siyuan.storage[Constants.LOCAL_MOVE_PATH].keys;
            list.splice(0, 0, inputElement.value);
            list = Array.from(new Set(list));
            if (list.length > window.siyuan.config.search.limit) {
                list.splice(window.siyuan.config.search.limit, list.length - window.siyuan.config.search.limit);
            }
            window.siyuan.storage[Constants.LOCAL_MOVE_PATH].keys = list;
        }
        window.siyuan.storage[Constants.LOCAL_MOVE_PATH].k = inputElement.value;
        setStorageVal(Constants.LOCAL_MOVE_PATH, window.siyuan.storage[Constants.LOCAL_MOVE_PATH]);
    });
    const lineHeight = 28;
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (matchHotKey("⌥↓", event)) {
            event.stopPropagation();
            toggleMovePathHistory();
            return;
        }
        if (window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_MOVE_PATH_HISTORY) {
            return;
        }
        const currentPanelElement = searchListElement.classList.contains("fn__none") ? searchTreeElement : searchListElement;
        const currentItemElements = currentPanelElement.querySelectorAll(".b3-list-item--focus");
        if (currentItemElements.length === 0) {
            return;
        }
        let currentItemElement: HTMLElement = currentItemElements[0] as HTMLElement;
        if (event.key.startsWith("Arrow")) {
            currentItemElements.forEach((item, index) => {
                if (index !== 0) {
                    item.classList.remove("b3-list-item--focus");
                }
            });
        }
        if (searchListElement.classList.contains("fn__none")) {
            if ((event.key === "ArrowRight" && !currentItemElement.querySelector(".b3-list-item__arrow--open") && !currentItemElement.querySelector(".b3-list-item__toggle").classList.contains("fn__hidden")) ||
                (event.key === "ArrowLeft" && currentItemElement.querySelector(".b3-list-item__arrow--open"))) {
                getLeaf(currentItemElement, options.flashcard);
                event.preventDefault();
                return;
            }
            if (event.key === "ArrowLeft") {
                let parentElement = currentItemElement.parentElement.previousElementSibling;
                if (parentElement) {
                    if (parentElement.tagName !== "LI") {
                        parentElement = currentPanelElement.querySelector(".b3-list-item");
                    }
                    currentItemElement.classList.remove("b3-list-item--focus");
                    parentElement.classList.add("b3-list-item--focus");
                    const parentRect = parentElement.getBoundingClientRect();
                    const fileRect = currentPanelElement.getBoundingClientRect();
                    if (parentRect.top < fileRect.top || parentRect.bottom > fileRect.bottom) {
                        parentElement.scrollIntoView(parentRect.top < fileRect.top);
                    }
                }
                event.preventDefault();
                return true;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                let nextElement = currentItemElement;
                while (nextElement) {
                    if (nextElement.nextElementSibling) {
                        if (nextElement.nextElementSibling.classList.contains("fn__none")) {
                            nextElement = nextElement.nextElementSibling as HTMLElement;
                        } else {
                            if (nextElement.nextElementSibling.tagName === "UL") {
                                nextElement = nextElement.nextElementSibling.firstElementChild as HTMLElement;
                            } else {
                                nextElement = nextElement.nextElementSibling as HTMLElement;
                            }
                            break;
                        }
                    } else {
                        if (nextElement.parentElement.id === "foldTree") {
                            break;
                        } else {
                            nextElement = nextElement.parentElement;
                        }
                    }
                }
                if (nextElement.classList.contains("b3-list-item")) {
                    currentItemElement.classList.remove("b3-list-item--focus");
                    nextElement.classList.add("b3-list-item--focus");
                    const nextRect = nextElement.getBoundingClientRect();
                    const fileRect = searchTreeElement.getBoundingClientRect();
                    if (nextRect.top < fileRect.top || nextRect.bottom > fileRect.bottom) {
                        nextElement.scrollIntoView(nextRect.top < fileRect.top);
                    }
                }
                event.preventDefault();
                return true;
            }
            if (event.key === "ArrowUp") {
                let previousElement = currentItemElement;
                while (previousElement) {
                    if (previousElement.previousElementSibling) {
                        if (previousElement.previousElementSibling.classList.contains("fn__none")) {
                            previousElement = previousElement.previousElementSibling as HTMLElement;
                        } else {
                            if (previousElement.previousElementSibling.tagName === "LI") {
                                previousElement = previousElement.previousElementSibling as HTMLElement;
                            } else {
                                const liElements = previousElement.previousElementSibling.querySelectorAll(".b3-list-item");
                                previousElement = liElements[liElements.length - 1] as HTMLElement;
                            }
                            break;
                        }
                    } else {
                        if (previousElement.parentElement.id === "foldTree") {
                            break;
                        } else {
                            previousElement = previousElement.parentElement;
                        }
                    }
                }
                if (previousElement.classList.contains("b3-list-item")) {
                    currentItemElement.classList.remove("b3-list-item--focus");
                    previousElement.classList.add("b3-list-item--focus");
                    const previousRect = previousElement.getBoundingClientRect();
                    const fileRect = searchTreeElement.getBoundingClientRect();
                    if (previousRect.top < fileRect.top || previousRect.bottom > fileRect.bottom) {
                        previousElement.scrollIntoView(previousRect.top < fileRect.top);
                    }
                }
                event.preventDefault();
            }
        } else {
            if (event.key === "ArrowDown") {
                currentItemElement.classList.remove("b3-list-item--focus");
                if (!currentItemElement.nextElementSibling) {
                    currentPanelElement.children[0].classList.add("b3-list-item--focus");
                } else {
                    currentItemElement.nextElementSibling.classList.add("b3-list-item--focus");
                }
                currentItemElement = currentPanelElement.querySelector(".b3-list-item--focus");
                if (currentPanelElement.scrollTop < currentItemElement.offsetTop - currentPanelElement.clientHeight + lineHeight ||
                    currentPanelElement.scrollTop > currentItemElement.offsetTop) {
                    currentPanelElement.scrollTop = currentItemElement.offsetTop - currentPanelElement.clientHeight + lineHeight;
                }
                event.preventDefault();
                return;
            }
            if (event.key === "ArrowUp") {
                currentItemElement.classList.remove("b3-list-item--focus");
                if (!currentItemElement.previousElementSibling) {
                    const length = currentPanelElement.children.length;
                    currentPanelElement.children[length - 1].classList.add("b3-list-item--focus");
                } else {
                    currentItemElement.previousElementSibling.classList.add("b3-list-item--focus");
                }
                currentItemElement = currentPanelElement.querySelector(".b3-list-item--focus");
                if (currentPanelElement.scrollTop < currentItemElement.offsetTop - currentPanelElement.clientHeight + lineHeight ||
                    currentPanelElement.scrollTop > currentItemElement.offsetTop - lineHeight * 2) {
                    currentPanelElement.scrollTop = currentItemElement.offsetTop - lineHeight * 2;
                }
                event.preventDefault();
                return;
            }
        }
        if (event.key === "Enter") {
            const currentItemElements = currentPanelElement.querySelectorAll(".b3-list-item--focus");
            if (currentItemElements.length === 0) {
                return;
            }
            const pathList: string[] = [];
            const notebookIdList: string[] = [];
            currentItemElements.forEach(item => {
                pathList.push(item.getAttribute("data-path"));
                notebookIdList.push(item.getAttribute("data-box"));
            });
            options.cb(pathList, notebookIdList);
            dialog.destroy();
            event.preventDefault();
        }
    });
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(dialog.element)) {
            if (target.classList.contains("b3-list-item__toggle")) {
                getLeaf(target.parentElement, options.flashcard);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-form__icon-list")) {
                toggleMovePathHistory();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-button--text")) {
                const currentPanelElement = searchListElement.classList.contains("fn__none") ? searchTreeElement : searchListElement;
                const currentItemElements = currentPanelElement.querySelectorAll(".b3-list-item--focus");
                if (currentItemElements.length === 0) {
                    return;
                }
                const pathList: string[] = [];
                const notebookIdList: string[] = [];
                currentItemElements.forEach(item => {
                    pathList.push(item.getAttribute("data-path"));
                    notebookIdList.push(item.getAttribute("data-box"));
                });
                options.cb(pathList, notebookIdList);
                dialog.destroy();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-button--cancel")) {
                dialog.destroy();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-list-item")) {
                const currentPanelElement = searchListElement.classList.contains("fn__none") ? searchTreeElement : searchListElement;
                const currentItemElements = currentPanelElement.querySelectorAll(".b3-list-item--focus");
                if (currentItemElements.length === 0) {
                    return;
                }
                if (options.title === window.siyuan.languages.specifyPath && isOnlyMeta(event)) {
                    if (currentItemElements.length === 1 && currentItemElements[0] === target) {
                        // 至少需选中一个
                    } else {
                        target.classList.toggle("b3-list-item--focus");
                    }
                } else {
                    currentItemElements[0].classList.remove("b3-list-item--focus");
                    target.classList.add("b3-list-item--focus");
                }
                if (target.getAttribute("data-path") === "/") {
                    getLeaf(target, options.flashcard);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
        /// #if !MOBILE
        inputElement.focus();
        /// #endif
    });
};

const getLeaf = (liElement: HTMLElement, flashcard: boolean) => {
    const toggleElement = liElement.querySelector(".b3-list-item__arrow");
    if (toggleElement.classList.contains("b3-list-item__arrow--open")) {
        toggleElement.classList.remove("b3-list-item__arrow--open");
        if (liElement.nextElementSibling && liElement.nextElementSibling.tagName === "UL") {
            liElement.nextElementSibling.classList.add("fn__none");
        }
        return;
    }
    if (liElement.nextElementSibling && liElement.nextElementSibling.tagName === "UL") {
        toggleElement.classList.add("b3-list-item__arrow--open");
        liElement.nextElementSibling.classList.remove("fn__none");
        return;
    }
    if (liElement.getAttribute("data-loading") === "true") {
        return;
    }
    liElement.setAttribute("data-loading", "true");
    const notebookId = liElement.getAttribute("data-box");
    fetchPost("/api/filetree/listDocsByPath", {
        notebook: notebookId,
        path: liElement.getAttribute("data-path"),
        flashcard,
        app: Constants.SIYUAN_APPID,
    }, response => {
        liElement.removeAttribute("data-loading");
        if (response.data.files.length === 0) {
            showMessage(window.siyuan.languages.emptyContent);
            return;
        }
        let fileHTML = "";
        response.data.files.forEach((item: IFile) => {
            let countHTML = "";
            if (flashcard) {
                countHTML = `<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardNewCard}">${item.newFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardDueCard}">${item.dueFlashcardCount}</span>
<span class="counter counter--right b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.flashcardCard}">${item.flashcardCount}</span>`;
            } else if (item.count && item.count > 0) {
                countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.ref}">${item.count}</span>`;
            }
            fileHTML += `<li data-box="${notebookId}" class="b3-list-item" data-path="${item.path}">
    <span style="padding-left: ${item.path.split("/").length * 8}px" class="b3-list-item__toggle b3-list-item__toggle--hl${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${unicode2Emoji(item.icon || (item.subFileCount === 0 ? window.siyuan.storage[Constants.LOCAL_IMAGES].file : window.siyuan.storage[Constants.LOCAL_IMAGES].folder), "b3-list-item__graphic", true)}
    <span class="b3-list-item__text ariaLabel" data-position="parentE" aria-label="${getDisplayName(item.name, true, true)} <small class='ft__on-surface'>${item.hSize}</small>${item.bookmark ? "<br>" + window.siyuan.languages.bookmark + " " + item.bookmark : ""}${item.name1 ? "<br>" + window.siyuan.languages.name + " " + item.name1 : ""}${item.alias ? "<br>" + window.siyuan.languages.alias + " " + item.alias : ""}${item.memo ? "<br>" + window.siyuan.languages.memo + " " + item.memo : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}<br>${window.siyuan.languages.modifiedAt} ${item.hMtime}<br>${window.siyuan.languages.createdAt} ${item.hCtime}">${getDisplayName(item.name, true, true)}</span>
    ${countHTML}
</li>`;
        });
        if (fileHTML === "") {
            return;
        }
        toggleElement.classList.add("b3-list-item__arrow--open");
        liElement.insertAdjacentHTML("afterend", `<ul class="file-tree__sliderDown">${fileHTML}</ul>`);
        const nextElement = liElement.nextElementSibling;
        setTimeout(() => {
            nextElement.setAttribute("style", `height:${nextElement.childElementCount * liElement.clientHeight}px;`);
            setTimeout(() => {
                nextElement.classList.remove("file-tree__sliderDown");
                nextElement.removeAttribute("style");
            }, 120);
        }, 2);
    });
};

export const getNotebookName = (id: string) => {
    let rootPath = "";
    window.siyuan.notebooks.find((item) => {
        if (item.id === id) {
            rootPath = item.name;
            return true;
        }
    });
    return rootPath;
};

export const getNotebookIcon = (id: string) => {
    let rootPath = "";
    window.siyuan.notebooks.find((item) => {
        if (item.id === id) {
            rootPath = item.icon;
            return true;
        }
    });
    return rootPath;
};

export const setNotebookName = (id: string, name: string) => {
    window.siyuan.notebooks.find((item) => {
        if (item.id === id) {
            item.name = name;
            return true;
        }
    });
};

export const getOpenNotebookCount = () => {
    let count = 0;
    window.siyuan.notebooks.forEach(item => {
        if (!item.closed) {
            count++;
        }
    });
    return count;
};

export const setNoteBook = (cb?: (notebook: INotebook[]) => void, flashcard = false) => {
    fetchPost("/api/notebook/lsNotebooks", {
        flashcard
    }, (response) => {
        if (!flashcard) {
            window.siyuan.notebooks = response.data.notebooks;
        }
        if (cb) {
            cb(response.data.notebooks);
        }
    });
};
