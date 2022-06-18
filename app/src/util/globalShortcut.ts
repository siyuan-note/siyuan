import {isCtrl, isMac, writeText} from "../protyle/util/compatibility";
import {matchHotKey} from "../protyle/util/hotKey";
import {openSearch} from "../search/spread";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName, hasClosestByMatchTag,
    hasTopClosestByClassName,
    hasTopClosestByTag,
} from "../protyle/util/hasClosest";
import {newFile} from "./newFile";
import {Constants} from "../constants";
import {openSetting} from "../config";
import {exportLayout, getDockByType, getInstanceById, setPanelFocus} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Editor} from "../editor";
import {setEditMode} from "../protyle/util/setEditMode";
import {rename} from "../editor/rename";
import {Files} from "../layout/dock/Files";
import {newDailyNote} from "./mount";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost} from "./fetch";
import {goBack, goForward} from "./backForward";
import {onGet} from "../protyle/util/onGet";
import {getDisplayName, getNotebookName, movePathTo} from "./pathName";
import {confirmDialog} from "../dialog/confirmDialog";
import {deleteFile, openFileById} from "../editor/util";
import {getAllDocks, getAllModels, getAllTabs} from "../layout/getAll";
import {openGlobalSearch} from "../search/util";
import {getColIndex} from "../protyle/util/table";
import {focusBlock, focusByRange} from "../protyle/util/selection";
import {initFileMenu, initNavigationMenu} from "../menus/navigation";
import {bindMenuKeydown} from "../menus/Menu";
import {showMessage} from "../dialog/message";
import {openHistory} from "./history";

const getRightBlock = (element: HTMLElement, x: number, y: number) => {
    let index = 1;
    let nodeElement = element;
    while (nodeElement && (nodeElement.classList.contains("list") || nodeElement.classList.contains("li"))) {
        nodeElement = document.elementFromPoint(x + 73 * index, y) as HTMLElement;
        nodeElement = hasClosestBlock(nodeElement) as HTMLElement;
        index++;
    }
    return nodeElement;
};

export const globalShortcut = () => {
    window.addEventListener("mousemove", (event) => {
        if (window.siyuan.hideBreadcrumb) {
            getAllModels().editor.forEach(item => {
                item.editor.protyle.breadcrumb.show();
            });
            window.siyuan.blockPanels.forEach(item => {
                item.editors.forEach(edit => {
                    edit.protyle.breadcrumb.show();
                });
            });
        }

        const eventPath0 = event.composedPath()[0] as HTMLElement;
        if (eventPath0 && eventPath0.nodeType !== 3 && eventPath0.classList.contains("protyle-wysiwyg")) {
            // 光标在编辑器右边也需要进行显示
            const mouseElement = document.elementFromPoint(eventPath0.getBoundingClientRect().left + parseInt(eventPath0.style.paddingLeft) + 13, event.clientY);
            const blockElement = hasClosestBlock(mouseElement);
            if (blockElement) {
                const targetBlockElement = getRightBlock(blockElement, blockElement.getBoundingClientRect().left + 1, event.clientY);
                if (!targetBlockElement) {
                    return;
                }
                const hasTab = getAllModels().editor.find(item => {
                    if (item.editor.protyle.wysiwyg.element.isSameNode(eventPath0)) {
                        item.editor.protyle.gutter.render(targetBlockElement, item.editor.protyle.wysiwyg.element);
                        return true;
                    }
                });
                if (!hasTab) {
                    window.siyuan.blockPanels.find(item => {
                        const hasEdit = item.editors.find(eItem => {
                            if (eItem.protyle.wysiwyg.element.contains(eventPath0)) {
                                eItem.protyle.gutter.render(targetBlockElement, eItem.protyle.wysiwyg.element);
                                return true;
                            }
                        });
                        if (hasEdit) {
                            return true;
                        }
                    });
                }
            }
            return;
        }
        if (eventPath0 && eventPath0.nodeType !== 3 && (eventPath0.classList.contains("li") || eventPath0.classList.contains("list"))) {
            // 光标在列表下部应显示右侧的元素，而不是列表本身
            const targetBlockElement = getRightBlock(eventPath0, eventPath0.getBoundingClientRect().left + 1, event.clientY);
            if (!targetBlockElement) {
                return;
            }
            const hasTab = getAllModels().editor.find(item => {
                if (item.editor.protyle.wysiwyg.element.contains(eventPath0)) {
                    item.editor.protyle.gutter.render(targetBlockElement, item.editor.protyle.wysiwyg.element);
                    return true;
                }
            });
            if (!hasTab) {
                window.siyuan.blockPanels.find(item => {
                    const hasEdit = item.editors.find(eItem => {
                        if (eItem.protyle.wysiwyg.element.contains(eventPath0)) {
                            eItem.protyle.gutter.render(targetBlockElement, eItem.protyle.wysiwyg.element);
                            return true;
                        }
                    });
                    if (hasEdit) {
                        return true;
                    }
                });
            }
            return;
        }

        const target = event.target as Element;
        const blockElement = hasClosestBlock(target);
        if (blockElement && blockElement.style.cursor !== "col-resize" && !hasClosestByClassName(blockElement, "protyle-wysiwyg__embed")) {
            const cellElement = (hasClosestByMatchTag(target, "TH") || hasClosestByMatchTag(target, "TD")) as HTMLTableCellElement;
            if (cellElement) {
                const tableElement = blockElement.querySelector("table");
                const tableHeight = blockElement.querySelector("table").clientHeight;
                const resizeElement = blockElement.querySelector(".table__resize");
                if (blockElement.style.textAlign === "center" || blockElement.style.textAlign === "right") {
                    resizeElement.parentElement.style.left = tableElement.offsetLeft + "px";
                } else {
                    resizeElement.parentElement.style.left = "";
                }
                const rect = cellElement.getBoundingClientRect();
                if (rect.right - event.clientX < 3 && rect.right - event.clientX > 0) {
                    resizeElement.setAttribute("data-col-index", (getColIndex(cellElement) + cellElement.colSpan - 1).toString());
                    resizeElement.setAttribute("style", `height:${tableHeight}px;left: ${Math.round(cellElement.offsetWidth + cellElement.offsetLeft - blockElement.firstElementChild.scrollLeft - 3)}px;display:block`);
                } else if (event.clientX - rect.left < 3 && event.clientX - rect.left > 0 && cellElement.previousElementSibling) {
                    resizeElement.setAttribute("data-col-index", (getColIndex(cellElement) - 1).toString());
                    resizeElement.setAttribute("style", `height:${tableHeight}px;left: ${Math.round(cellElement.offsetLeft - blockElement.firstElementChild.scrollLeft - 3)}px;display:block`);
                }
            }
        }
    });

    window.addEventListener("mouseup", (event) => {
        if (event.button === 3) {
            event.stopPropagation();
            event.preventDefault();
            goBack();
        } else if (event.button === 4) {
            event.stopPropagation();
            event.preventDefault();
            goForward();
        }
    });

    window.addEventListener("keyup", (event) => {
        window.siyuan.ctrlIsPressed = false;
        window.siyuan.shiftIsPressed = false;
        window.siyuan.altIsPressed = false;
        if ((event.target as HTMLElement).tagName === "INPUT" || (event.target as HTMLElement).tagName === "TEXTAREA") {
            return;
        }
        if (!hasClosestBlock(document.activeElement)) {
            return;
        }
    });

    window.addEventListener("keydown", (event) => {
        if (document.getElementById("errorLog") || event.isComposing) {
            return;
        }

        // 仅处理以下快捷键操作
        if (!event.ctrlKey && !isCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey &&
            !/^F\d{1,2}$/.test(event.key) && event.key.indexOf("Arrow") === -1 && event.key !== "Enter" && event.key !== "Backspace" && event.key !== "Delete") {
            return;
        }

        if (!event.altKey && !event.shiftKey && isCtrl(event)) {
            if (event.key === "Meta" || event.key === "Control" || event.ctrlKey || event.metaKey) {
                window.siyuan.ctrlIsPressed = true;
            } else {
                window.siyuan.ctrlIsPressed = false;
            }
        }
        if (!event.altKey && event.shiftKey && !isCtrl(event)) {
            if (event.key === "Shift") {
                window.siyuan.shiftIsPressed = true;
            } else {
                window.siyuan.shiftIsPressed = false;
            }
        }
        if (event.altKey && !event.shiftKey && !isCtrl(event)) {
            if (event.key === "Alt") {
                window.siyuan.altIsPressed = true;
            } else {
                window.siyuan.altIsPressed = false;
            }
        }

        if (event.ctrlKey && !event.metaKey && event.key === "Tab") {
            const allTabs = getAllTabs();
            if (allTabs.length === 0) {
                return;
            }
            let currentTabElement = document.querySelector(".layout__wnd--active .layout-tab-bar > .item--focus");
            if (!currentTabElement) {
                currentTabElement = allTabs[0].headElement.parentElement.querySelector(".item--focus");
                if (!currentTabElement) {
                    return;
                }
            }
            let currentIndex = 0;
            allTabs.find((item, index) => {
                if (item.id === currentTabElement.getAttribute("data-id")) {
                    currentIndex = index;
                    return true;
                }
            });
            if (allTabs[currentIndex].model instanceof Editor) {
                // range 已在新页面上才会触发 focusout，导致无法记录原有页面的 range，因此需要先记录一次。
                (allTabs[currentIndex].model as Editor).editor.protyle.wysiwyg.element.dispatchEvent(new CustomEvent("focusout"));
            }
            if (event.shiftKey) {
                if (currentIndex === 0) {
                    currentIndex = allTabs.length - 1;
                } else {
                    currentIndex--;
                }
            } else {
                if (currentIndex === allTabs.length - 1) {
                    currentIndex = 0;
                } else {
                    currentIndex++;
                }
            }
            allTabs[currentIndex].parent.switchTab(allTabs[currentIndex].headElement);
            setPanelFocus(allTabs[currentIndex].headElement.parentElement.parentElement);
            return;
        }

        if (event.key === "F9") {
            document.getElementById("barSync").dispatchEvent(new Event("click"));
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.general.lockScreen.custom, event)) {
            exportLayout(false, () => {
                fetchPost("/api/system/logoutAuth", {}, () => {
                    window.location.href = "/";
                });
            });
            event.preventDefault();
            return;
        }
        if (!window.siyuan.config.readonly && matchHotKey(window.siyuan.config.keymap.general.history.custom, event)) {
            openHistory();
            event.preventDefault();
            return;
        }
        if (!window.siyuan.config.readonly && matchHotKey(window.siyuan.config.keymap.general.config.custom, event)) {
            openSetting();
            event.preventDefault();
            return;
        }
        // https://github.com/siyuan-note/insider/issues/445
        if (matchHotKey("⌘S", event)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        const target = event.target as HTMLElement;
        if (matchHotKey("⌘A", event) && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
            event.preventDefault();
            return;
        }
        const matchDock = getAllDocks().find(item => {
            if (matchHotKey(window.siyuan.config.keymap.general[item.hotkeyLangId].custom, event)) {
                getDockByType(item.type).toggleModel(item.type);
                if (target.classList.contains("protyle-wysiwyg") ||
                    target.classList.contains("protyle-title__input") ||
                    target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
                    target.blur();
                }
                event.preventDefault();
                return true;
            }
        });
        if (matchDock) {
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.general.dailyNote.custom, event)) {
            newDailyNote();
            if (target.classList.contains("protyle-wysiwyg") ||
                target.classList.contains("protyle-title__input") ||
                target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
                target.blur();
            }
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.general.newFile.custom, event)) {
            newFile(undefined, undefined, true);
            event.preventDefault();
            return;
        }

        if (event.key === "Escape" && !event.isComposing) {
            const imgPreviewElement = document.querySelector(".protyle-img");
            if (imgPreviewElement) {
                imgPreviewElement.remove();
                return;
            }
            if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                window.siyuan.menus.menu.remove();
                return;
            }
            if (window.siyuan.dialogs.length > 0) {
                hideElements(["dialog"]);
                return;
            }

            // remove blockpopover
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
                        maxEditLevels[oid] = 1;
                    }
                }
            });
            let destroyBlock = false;
            for (let i = 0; i < window.siyuan.blockPanels.length; i++) {
                const item = window.siyuan.blockPanels[i];
                if (item.targetElement && item.element.getAttribute("data-pin") === "false" &&
                    parseInt(item.element.getAttribute("data-level")) > (maxEditLevels[item.element.getAttribute("data-oid")] || 0)) {
                    item.destroy();
                    if (item.esc) {
                        item.esc();
                    }
                    destroyBlock = true;
                    i--;
                }
            }
            if (destroyBlock) {
                return;
            }

            // 光标在文档树等面板中，按 Esc 回到编辑器中 https://github.com/siyuan-note/siyuan/issues/4289
            let range;
            if (getSelection().rangeCount > 0) {
                range = getSelection().getRangeAt(0);
                const protypleElement = hasClosestByClassName(range.startContainer, "protyle-content", true);
                if (protypleElement) {
                    focusByRange(range);
                    return;
                }
            } else {
                range = document.createRange();
            }
            const lastBackStack = window.siyuan.backStack[window.siyuan.backStack.length - 1];
            if (lastBackStack && lastBackStack.protyle.toolbar.range) {
                focusByRange(lastBackStack.protyle.toolbar.range);
            } else {
                const editor = getAllModels().editor[0];
                if (editor) {
                    focusBlock(editor.editor.protyle.wysiwyg.element.firstElementChild);
                }
            }
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.goForward.custom, event)) {
            goForward();
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.goBack.custom, event)) {
            goBack();
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        const confirmElement = document.querySelector("#confirmDialogConfirmBtn");
        if (confirmElement && event.key === "Enter") {
            confirmElement.dispatchEvent(new CustomEvent("click"));
            event.preventDefault();
            return;
        }

        // 面板折叠展开操作
        if (matchHotKey("⌘↑", event) || matchHotKey("⌘↓", event)) {
            let activePanelElement = document.querySelector(".block__icons--active");
            if (!activePanelElement) {
                Array.from(document.querySelectorAll(".layout__wnd--active .layout-tab-container > div")).forEach(item => {
                    if (!item.classList.contains("fn__none")) {
                        activePanelElement = item;
                        return true;
                    }
                });
            }
            if (activePanelElement) {
                if (matchHotKey("⌘↑", event)) {
                    if (activePanelElement.querySelector('.block__icon[data-type="collapse"]')) {
                        activePanelElement.querySelector('.block__icon[data-type="collapse"]').dispatchEvent(new CustomEvent("click"));
                    }
                } else if (matchHotKey("⌘↓", event)) {
                    if (activePanelElement.querySelector('.block__icon[data-type="expand"]')) {
                        activePanelElement.querySelector('.block__icon[data-type="expand"]').dispatchEvent(new CustomEvent("click"));
                    }
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // close tab
        if (matchHotKey(window.siyuan.config.keymap.general.closeTab.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            let activeTabElement = document.querySelector(".block__icons--active");
            if (activeTabElement && activeTabElement.getBoundingClientRect().width > 0) {
                const type = activeTabElement.parentElement.className.split("sy__")[1] as TDockType;
                getDockByType(type).toggleModel(type, false, true);
                return;
            }
            activeTabElement = document.querySelector(".layout__wnd--active .item--focus");
            if (activeTabElement) {
                const tab = getInstanceById(activeTabElement.getAttribute("data-id")) as Tab;
                tab.parent.removeTab(tab.id);
                return;
            }
            getAllTabs().find(item => {
                if (item.headElement?.classList.contains("item--focus")) {
                    item.parent.removeTab(item.id);
                    return;
                }
            });
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.stickSearch.custom, event)) {
            if (getSelection().rangeCount > 0) {
                const range = getSelection().getRangeAt(0);
                openGlobalSearch(range.toString(), false);
            } else {
                openGlobalSearch("", false);
            }
            event.preventDefault();
            return;
        }

        if (editKeydown(event)) {
            return;
        }

        // 文件树的操作
        if (fileTreeKeydown(event)) {
            return;
        }

        let searchKey = "";
        if (matchHotKey(window.siyuan.config.keymap.general.replace.custom, event)) {
            searchKey = window.siyuan.config.keymap.general.replace.custom;
        } else if (!hasClosestByClassName(target, "pdf__outer") && matchHotKey(window.siyuan.config.keymap.general.search.custom, event)) {
            searchKey = window.siyuan.config.keymap.general.search.custom;
        } else if (matchHotKey(window.siyuan.config.keymap.general.globalSearch.custom, event)) {
            searchKey = window.siyuan.config.keymap.general.globalSearch.custom;
        }
        if (searchKey) {
            if (getSelection().rangeCount > 0) {
                const range = getSelection().getRangeAt(0);
                openSearch(searchKey, range.toString());
            } else {
                openSearch(searchKey);
            }
            event.preventDefault();
            return;
        }
    });

    window.addEventListener("blur", () => {
        window.siyuan.ctrlIsPressed = false;
        window.siyuan.shiftIsPressed = false;
        window.siyuan.altIsPressed = false;
    });

    window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
        if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
            if (getSelection().rangeCount > 0 && window.siyuan.menus.menu.element.contains(getSelection().getRangeAt(0).startContainer)) {
                // https://ld246.com/article/1654567749834/comment/1654589171218#comments
            } else {
                window.siyuan.menus.menu.remove();
            }
        }
        if (!hasClosestByClassName(event.target, "pdf__outer")) {
            document.querySelectorAll(".pdf__util").forEach(item => {
                item.classList.add("fn__none");
            });
        }
        const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
        if (copyElement) {
            writeText(copyElement.parentElement.nextElementSibling.textContent.trimEnd());
            showMessage(window.siyuan.languages.copied, 2000);
            event.preventDefault();
            event.stopPropagation();
        }

        // 点击空白，pdf 搜索、更多消失
        if (hasClosestByAttribute(event.target, "id", "secondaryToolbarToggle") ||
            hasClosestByAttribute(event.target, "id", "viewFind") ||
            hasClosestByAttribute(event.target, "id", "findbar")) {
            return;
        }
        let currentPDFViewerObject: any;
        getAllModels().asset.find(item => {
            if (item.pdfObject &&
                !item.pdfObject.appConfig.appContainer.classList.contains("fn__none")) {
                currentPDFViewerObject = item.pdfObject;
                return true;
            }
        });
        if (!currentPDFViewerObject) {
            return;
        }
        if (currentPDFViewerObject.secondaryToolbar.isOpen) {
            currentPDFViewerObject.secondaryToolbar.close();
        }
        if (
            !currentPDFViewerObject.supportsIntegratedFind &&
            currentPDFViewerObject.findBar.opened
        ) {
            currentPDFViewerObject.findBar.close();
        }
    });
};

const editKeydown = (event: KeyboardEvent) => {
    const activeTabElement = document.querySelector(".layout__wnd--active .item--focus");
    let protyle: IProtyle;
    if (activeTabElement) {
        const tab = getInstanceById(activeTabElement.getAttribute("data-id")) as Tab;
        if (!(tab.model instanceof Editor)) {
            return false;
        }
        protyle = tab.model.editor.protyle;
    } else {
        const editor = getAllModels().editor.find(item => {
            if (item.parent.headElement.classList.contains("item--focus")) {
                return true;
            }
        });
        if (!editor) {
            return false;
        }
        protyle = editor.editor.protyle;
    }
    const activePanelElement = document.querySelector(".block__icons--active");
    let isFileFocus = false;
    if (activePanelElement && activePanelElement.parentElement.classList.contains("sy__file")) {
        isFileFocus = true;
    }
    let searchKey = "";
    if (matchHotKey(window.siyuan.config.keymap.general.replace.custom, event)) {
        searchKey = window.siyuan.config.keymap.general.replace.custom;
    } else if (matchHotKey(window.siyuan.config.keymap.general.search.custom, event)) {
        searchKey = window.siyuan.config.keymap.general.search.custom;
    }
    if (!isFileFocus && searchKey) {
        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        if (range && protyle.element.contains(range.startContainer)) {
            openSearch(searchKey, range.toString(), protyle.notebookId, protyle.path);
        } else {
            openSearch(searchKey);
        }
        event.preventDefault();
        return true;
    }
    if (!isFileFocus && matchHotKey(window.siyuan.config.keymap.general.move.custom, event)) {
        let range: Range;
        let nodeElement: false | HTMLElement;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            nodeElement = hasClosestBlock(range.startContainer);
        }
        if (nodeElement && range && protyle.element.contains(range.startContainer)) {
            protyle.toolbar.showFile(protyle, [nodeElement], range);
        } else {
            movePathTo(protyle.notebookId, protyle.path);
        }
        event.preventDefault();
        return true;
    }
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || hasClosestByAttribute(target, "contenteditable", null)) {
        return false;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.preview.custom, event)) {
        setEditMode(protyle, "preview");
        event.preventDefault();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.wysiwyg.custom, event)) {
        setEditMode(protyle, "wysiwyg");
        protyle.scroll.lastScrollTop = 0;
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.parentID,
            size: Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, protyle);
        });
        event.preventDefault();
        return true;
    }
    // 没有光标时，无法撤销 https://ld246.com/article/1624021111567
    if (matchHotKey(window.siyuan.config.keymap.editor.general.undo.custom, event)) {
        protyle.undo.undo(protyle);
        event.preventDefault();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.redo.custom, event)) {
        protyle.undo.redo(protyle);
        event.preventDefault();
        return true;
    }
    return false;
};

const fileTreeKeydown = (event: KeyboardEvent) => {
    const dockFile = getDockByType("file");
    if (!dockFile) {
        return false;
    }
    const files = dockFile.data.file as Files;
    if (matchHotKey(window.siyuan.config.keymap.general.selectOpen1.custom, event)) {
        event.preventDefault();
        const element = document.querySelector(".layout__wnd--active > .layout-tab-bar > .item--focus") ||
            document.querySelector(".layout-tab-bar > .item--focus");
        if (element) {
            const tab = getInstanceById(element.getAttribute("data-id")) as Tab;
            if (tab && tab.model instanceof Editor) {
                files.selectItem(tab.model.editor.protyle.notebookId, tab.model.editor.protyle.path);
            }
        }
        return;
    }
    if (!files.element.previousElementSibling.classList.contains("block__icons--active")) {
        return false;
    }
    let liElement = files.element.querySelector(".b3-list-item--focus");
    if (!liElement) {
        if (event.key.startsWith("Arrow")) {
            liElement = files.element.querySelector(".b3-list-item");
            if (liElement) {
                liElement.classList.add("b3-list-item--focus");
            }
            event.preventDefault();
        }
        return false;
    }
    const topULElement = hasTopClosestByTag(liElement, "UL");
    if (!topULElement) {
        return false;
    }
    const notebookId = topULElement.getAttribute("data-url");
    const pathString = liElement.getAttribute("data-path");
    const isFile = liElement.getAttribute("data-type") === "navigation-file";
    if (matchHotKey(window.siyuan.config.keymap.editor.general.rename.custom, event)) {
        rename({
            notebookId,
            path: pathString,
            name: isFile ? getDisplayName(liElement.getAttribute("data-name"), false, true) : getNotebookName(notebookId),
            type: isFile ? "file" : "notebook",
        });
        return true;
    }
    if (matchHotKey("⌘/", event)) {
        const liRect = liElement.getBoundingClientRect();
        if (isFile) {
            initFileMenu(notebookId, pathString, liElement.getAttribute("data-node-id"), liElement.getAttribute("data-name")).popup({
                x: liRect.right - 15,
                y: liRect.top + 15
            });
        } else {
            initNavigationMenu(liElement as HTMLElement).popup({x: liRect.right - 15, y: liRect.top + 15});
        }
        return true;
    }
    if (isFile && matchHotKey(window.siyuan.config.keymap.general.move.custom, event)) {
        movePathTo(notebookId, pathString, false);
        event.preventDefault();
        return true;
    }
    let searchKey = "";
    if (matchHotKey(window.siyuan.config.keymap.general.replace.custom, event)) {
        searchKey = window.siyuan.config.keymap.general.replace.custom;
    } else if (matchHotKey(window.siyuan.config.keymap.general.search.custom, event)) {
        searchKey = window.siyuan.config.keymap.general.search.custom;
    }
    if (searchKey) {
        if (isFile) {
            openSearch(searchKey, undefined, notebookId, getDisplayName(pathString, false, true));
        } else {
            openSearch(searchKey, undefined, notebookId);
        }
        event.preventDefault();
        return true;
    }
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || hasClosestByAttribute(target, "contenteditable", null)) {
        return false;
    }
    if (bindMenuKeydown(event)) {
        event.stopPropagation();
        event.preventDefault();
        return true;
    }
    if ((event.key === "ArrowRight" && !liElement.querySelector(".b3-list-item__arrow--open") && !liElement.querySelector(".b3-list-item__toggle").classList.contains("fn__hidden")) ||
        (event.key === "ArrowLeft" && liElement.querySelector(".b3-list-item__arrow--open"))) {
        files.getLeaf(liElement, notebookId);
        event.preventDefault();
        return true;
    }
    const fileRect = files.element.getBoundingClientRect();
    if (event.key === "ArrowLeft") {
        let parentElement = liElement.parentElement.previousElementSibling;
        if (parentElement) {
            if (parentElement.tagName !== "LI") {
                parentElement = files.element.querySelector(".b3-list-item");
            }
            liElement.classList.remove("b3-list-item--focus");
            parentElement.classList.add("b3-list-item--focus");
            const parentRect = parentElement.getBoundingClientRect();
            if (parentRect.top < fileRect.top || parentRect.bottom > fileRect.bottom) {
                parentElement.scrollIntoView(parentRect.top < fileRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        let nextElement = liElement;
        while (nextElement) {
            if (nextElement.nextElementSibling) {
                if (nextElement.nextElementSibling.tagName === "UL") {
                    nextElement = nextElement.nextElementSibling.firstElementChild;
                } else {
                    nextElement = nextElement.nextElementSibling;
                }
                break;
            } else {
                if (nextElement.parentElement.classList.contains("fn__flex-1")) {
                    break;
                } else {
                    nextElement = nextElement.parentElement;
                }
            }
        }
        if (nextElement.classList.contains("b3-list-item")) {
            liElement.classList.remove("b3-list-item--focus");
            nextElement.classList.add("b3-list-item--focus");
            const nextRect = nextElement.getBoundingClientRect();
            if (nextRect.top < fileRect.top || nextRect.bottom > fileRect.bottom) {
                nextElement.scrollIntoView(nextRect.top < fileRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    if (event.key === "ArrowUp") {
        let previousElement = liElement;
        while (previousElement) {
            if (previousElement.previousElementSibling) {
                if (previousElement.previousElementSibling.tagName === "LI") {
                    previousElement = previousElement.previousElementSibling;
                } else {
                    const liElements = previousElement.previousElementSibling.querySelectorAll(".b3-list-item");
                    previousElement = liElements[liElements.length - 1];
                }
                break;
            } else {
                if (previousElement.parentElement.classList.contains("fn__flex-1")) {
                    break;
                } else {
                    previousElement = previousElement.parentElement;
                }
            }
        }
        if (previousElement.classList.contains("b3-list-item")) {
            liElement.classList.remove("b3-list-item--focus");
            previousElement.classList.add("b3-list-item--focus");
            const previousRect = previousElement.getBoundingClientRect();
            if (previousRect.top < fileRect.top || previousRect.bottom > fileRect.bottom) {
                previousElement.scrollIntoView(previousRect.top < fileRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    if (event.key === "Delete" || (event.key === "Backspace" && isMac())) {
        if (isFile) {
            deleteFile(notebookId, pathString, getDisplayName(liElement.getAttribute("data-name"), false, true));
        } else {
            confirmDialog(window.siyuan.languages.delete,
                `${window.siyuan.languages.confirmDelete} <b>${Lute.EscapeHTMLStr(getNotebookName(notebookId))}</b>?`, () => {
                    fetchPost("/api/notebook/removeNotebook", {
                        notebook: notebookId,
                        callback: Constants.CB_MOUNT_REMOVE
                    });
                });
        }
        return true;
    }
    if (event.key === "Enter") {
        if (isFile) {
            openFileById({id: liElement.getAttribute("data-node-id"), action: [Constants.CB_GET_FOCUS]});
        } else {
            files.getLeaf(liElement, notebookId);
        }
        return true;
    }
};
