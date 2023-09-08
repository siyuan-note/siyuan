import {isCtrl, isMac, updateHotkeyTip} from "../../protyle/util/compatibility";
import {matchHotKey} from "../../protyle/util/hotKey";
import {openSearch} from "../../search/spread";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasTopClosestByTag,
} from "../../protyle/util/hasClosest";
import {newFile} from "../../util/newFile";
import {Constants} from "../../constants";
import {openSetting} from "../../config";
import {getDockByType, getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {Editor} from "../../editor";
import {setEditMode} from "../../protyle/util/setEditMode";
import {rename} from "../../editor/rename";
import {Files} from "../../layout/dock/Files";
import {newDailyNote} from "../../util/mount";
import {hideElements} from "../../protyle/ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {goBack, goForward} from "../../util/backForward";
import {onGet} from "../../protyle/util/onGet";
import {getDisplayName, getNotebookName, getTopPaths, movePathTo, moveToPath} from "../../util/pathName";
import {openFileById} from "../../editor/util";
import {getAllDocks, getAllModels, getAllTabs} from "../../layout/getAll";
import {openGlobalSearch} from "../../search/util";
import {focusBlock, focusByRange} from "../../protyle/util/selection";
import {initFileMenu, initNavigationMenu} from "../../menus/navigation";
import {bindMenuKeydown} from "../../menus/Menu";
import {Dialog} from "../../dialog";
import {unicode2Emoji} from "../../emoji";
import {deleteFiles} from "../../editor/deleteFile";
import {escapeHtml} from "../../util/escape";
import {syncGuide} from "../../sync/syncGuide";
import {showPopover} from "../../block/popover";
import {getStartEndElement} from "../../protyle/wysiwyg/commonHotkey";
import {getNextFileLi, getPreviousFileLi} from "../../protyle/wysiwyg/getBlock";
import {editor} from "../../config/editor";
import {hintMoveBlock} from "../../protyle/hint/extend";
import {Backlink} from "../../layout/dock/Backlink";
/// #if !BROWSER
import {setZoom} from "../../layout/topBar";
import {getCurrentWindow} from "@electron/remote";
import {ipcRenderer} from "electron";
/// #endif
import {openHistory} from "../../history/history";
import {openCard, openCardByData} from "../../card/openCard";
import {lockScreen} from "../../dialog/processSystem";
import {isWindow} from "../../util/functions";
import {reloadProtyle} from "../../protyle/util/reload";
import {fullscreen} from "../../protyle/breadcrumb/action";
import {setPadding} from "../../protyle/ui/initUI";
import {openRecentDocs} from "../../business/openRecentDocs";
import {App} from "../../index";
import {commandPanel} from "../../plugin/commandPanel";
import {toggleDockBar} from "../../layout/dock/util";
import {workspaceMenu} from "../../menus/workspace";

const switchDialogEvent = (app: App, event: MouseEvent) => {
    event.preventDefault();
    let target = event.target as HTMLElement;
    while (!target.isSameNode(switchDialog.element)) {
        if (target.classList.contains("b3-list-item")) {
            const currentType = target.getAttribute("data-type");
            if (currentType) {
                if (currentType === "riffCard") {
                    openCard(app);
                } else {
                    getDockByType(currentType).toggleModel(currentType, true);
                }
            } else {
                const currentId = target.getAttribute("data-id");
                getAllTabs().find(item => {
                    if (item.id === currentId) {
                        item.parent.switchTab(item.headElement);
                        item.parent.showHeading();
                        return true;
                    }
                });
            }
            switchDialog.destroy();
            switchDialog = undefined;
            break;
        }
        target = target.parentElement;
    }
};

const dialogArrow = (app: App, element: HTMLElement, event: KeyboardEvent) => {
    let currentLiElement = element.querySelector(".b3-list-item--focus");
    if (currentLiElement) {
        currentLiElement.classList.remove("b3-list-item--focus");
        if (event.key === "ArrowUp") {
            if (currentLiElement.previousElementSibling) {
                currentLiElement.previousElementSibling.classList.add("b3-list-item--focus");
            } else {
                currentLiElement.parentElement.lastElementChild.classList.add("b3-list-item--focus");
            }
        } else if (event.key === "ArrowDown") {
            if (currentLiElement.nextElementSibling) {
                currentLiElement.nextElementSibling.classList.add("b3-list-item--focus");
            } else {
                currentLiElement.parentElement.firstElementChild.classList.add("b3-list-item--focus");
            }
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (isWindow()) {
                currentLiElement.classList.add("b3-list-item--focus");
            } else {
                const sideElement = currentLiElement.parentElement.previousElementSibling || currentLiElement.parentElement.nextElementSibling;
                (sideElement.querySelector(`[data-index="${currentLiElement.getAttribute("data-index")}"]`) || sideElement.lastElementChild).classList.add("b3-list-item--focus");
            }
        } else if (event.key === "Enter") {
            const currentType = currentLiElement.getAttribute("data-type");
            if (currentType) {
                if (currentType === "riffCard") {
                    openCard(app);
                } else {
                    getDockByType(currentType).toggleModel(currentType, true);
                }
            } else {
                openFileById({
                    app,
                    id: currentLiElement.getAttribute("data-node-id"),
                    action: [Constants.CB_GET_SCROLL]
                });
            }
            hideElements(["dialog"]);
            return;
        }
        currentLiElement = element.querySelector(".b3-list-item--focus");
        const rootId = currentLiElement.getAttribute("data-node-id");
        if (rootId) {
            fetchPost("/api/filetree/getFullHPathByID", {
                id: rootId
            }, (response) => {
                currentLiElement.parentElement.parentElement.nextElementSibling.innerHTML = escapeHtml(response.data);
            });
        } else {
            currentLiElement.parentElement.parentElement.nextElementSibling.innerHTML = currentLiElement.querySelector(".b3-list-item__text").innerHTML;
        }
        const currentRect = currentLiElement.getBoundingClientRect();
        const currentParentRect = currentLiElement.parentElement.getBoundingClientRect();
        if (currentRect.top < currentParentRect.top) {
            currentLiElement.scrollIntoView(true);
        } else if (currentRect.bottom > currentParentRect.bottom) {
            currentLiElement.scrollIntoView(false);
        }
    }
};

const editKeydown = (app: App, event: KeyboardEvent) => {
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
    const activePanelElement = document.querySelector(".layout__tab--active");
    let isFileFocus = false;
    if (activePanelElement && activePanelElement.classList.contains("sy__file")) {
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
            openSearch({
                app,
                hotkey: searchKey,
                key: range.toString(),
                notebookId: protyle.notebookId,
                searchPath: protyle.path
            });
        } else {
            openSearch({
                app,
                hotkey: searchKey,
            });
        }
        event.preventDefault();
        return true;
    }
    if (!isFileFocus && matchHotKey(window.siyuan.config.keymap.editor.general.spaceRepetition.custom, event)) {
        fetchPost("/api/riff/getTreeRiffDueCards", {rootID: protyle.block.rootID}, (response) => {
            openCardByData(app, response.data, "doc", protyle.block.rootID, protyle.title.editElement.textContent || "Untitled");
        });
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
        if (protyle.title?.editElement.contains(range.startContainer)) {
            movePathTo((toPath, toNotebook) => {
                moveToPath([protyle.path], toNotebook[0], toPath[0]);
            }, [protyle.path], range);
        } else if (nodeElement && range && protyle.element.contains(range.startContainer)) {
            let selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements = [nodeElement];
            }
            movePathTo((toPath) => {
                hintMoveBlock(toPath[0], selectElements, protyle);
            });
        }
        event.preventDefault();
        return true;
    }
    const target = event.target as HTMLElement;
    if (target.tagName !== "TABLE" && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || hasClosestByAttribute(target, "contenteditable", null)
    )) {
        return false;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.refresh.custom, event)) {
        reloadProtyle(protyle, true);
        event.preventDefault();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event)) {
        fullscreen(protyle.element);
        setPadding(protyle);
        event.preventDefault();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.preview.custom, event)) {
        setEditMode(protyle, "preview");
        event.preventDefault();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.wysiwyg.custom, event) && !protyle.options.backlinkData) {
        setEditMode(protyle, "wysiwyg");
        protyle.scroll.lastScrollTop = 0;
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.parentID,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({data: getResponse, protyle});
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

const fileTreeKeydown = (app: App, event: KeyboardEvent) => {
    const dockFile = getDockByType("file");
    if (!dockFile) {
        return false;
    }
    const files = dockFile.data.file as Files;

    if (matchHotKey(window.siyuan.config.keymap.general.selectOpen1.custom, event)) {
        event.preventDefault();
        const element = document.querySelector(".layout__wnd--active > .fn__flex > .layout-tab-bar > .item--focus") ||
            document.querySelector(".layout-tab-bar > .item--focus");
        if (element) {
            const tab = getInstanceById(element.getAttribute("data-id")) as Tab;
            if (tab && tab.model instanceof Editor) {
                tab.model.editor.protyle.wysiwyg.element.blur();
                tab.model.editor.protyle.title.editElement.blur();
                files.selectItem(tab.model.editor.protyle.notebookId, tab.model.editor.protyle.path);
            }
        }
        dockFile.toggleModel("file", true);
        return;
    }

    if (!files.element.parentElement.classList.contains("layout__tab--active")) {
        return false;
    }

    let matchCommand = false;
    app.plugins.find(item => {
        item.commands.find(command => {
            if (command.fileTreeCallback && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                command.fileTreeCallback(files);
                return true;
            }
        });
        if (matchCommand) {
            return true;
        }
    });
    if (matchCommand) {
        return true;
    }

    const liElements = Array.from(files.element.querySelectorAll(".b3-list-item--focus"));
    if (liElements.length === 0) {
        if (event.key.startsWith("Arrow") && !isCtrl(event)) {
            const liElement = files.element.querySelector(".b3-list-item");
            if (liElement) {
                liElement.classList.add("b3-list-item--focus");
            }
            event.preventDefault();
        }
        return false;
    }
    const topULElement = hasTopClosestByTag(liElements[0], "UL");
    if (!topULElement) {
        return false;
    }
    const notebookId = topULElement.getAttribute("data-url");
    const pathString = liElements[0].getAttribute("data-path");
    const isFile = liElements[0].getAttribute("data-type") === "navigation-file";

    if (matchHotKey(window.siyuan.config.keymap.editor.general.spaceRepetition.custom, event)) {
        if (isFile) {
            const id = liElements[0].getAttribute("data-node-id");
            fetchPost("/api/riff/getTreeRiffDueCards", {rootID: id}, (response) => {
                openCardByData(app, response.data, "doc", id, getDisplayName(liElements[0].getAttribute("data-name"), false, true));
            });
        } else {
            fetchPost("/api/riff/getNotebookRiffDueCards", {notebook: notebookId}, (response) => {
                openCardByData(app, response.data, "notebook", notebookId, getNotebookName(notebookId));
            });
        }
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.rename.custom, event)) {
        window.siyuan.menus.menu.remove();
        rename({
            notebookId,
            path: pathString,
            name: isFile ? getDisplayName(liElements[0].getAttribute("data-name"), false, true) : getNotebookName(notebookId),
            type: isFile ? "file" : "notebook",
        });
        event.preventDefault();
        return true;
    }

    if (matchHotKey("⌘/", event)) {
        const liRect = liElements[0].getBoundingClientRect();
        if (isFile) {
            initFileMenu(app, notebookId, pathString, liElements[0]).popup({
                x: liRect.right - 15,
                y: liRect.top + 15
            });
        } else {
            initNavigationMenu(app, liElements[0] as HTMLElement).popup({x: liRect.right - 15, y: liRect.top + 15});
        }
        return true;
    }

    if (isFile && matchHotKey(window.siyuan.config.keymap.general.move.custom, event)) {
        window.siyuan.menus.menu.remove();
        const pathes = getTopPaths(liElements);
        movePathTo((toPath, toNotebook) => {
            moveToPath(pathes, toNotebook[0], toPath[0]);
        }, pathes);
        event.preventDefault();
        return true;
    }

    if (isFile && matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
        window.siyuan.menus.menu.remove();
        openFileById({
            app,
            id: liElements[0].getAttribute("data-node-id"),
            action: [Constants.CB_GET_FOCUS],
            position: "right",
        });
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
        window.siyuan.menus.menu.remove();
        if (isFile) {
            openSearch({
                app,
                hotkey: searchKey,
                notebookId: notebookId,
                searchPath: getDisplayName(pathString, false, true)
            });
        } else {
            openSearch({
                app,
                hotkey: searchKey,
                notebookId: notebookId,
            });
        }
        event.preventDefault();
        return true;
    }
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        hasClosestByAttribute(target, "contenteditable", null) ||
        hasClosestByClassName(target, "protyle", true)) {
        return false;
    }
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        (event.code.startsWith("Arrow") || event.code === "Enter") &&
        !event.altKey && !event.shiftKey && !isCtrl(event)) {
        event.preventDefault();
        return true;
    }
    if (event.shiftKey) {
        if (event.key === "ArrowUp") {
            const startEndElement = getStartEndElement(liElements);
            let previousElement: Element;
            if (startEndElement.startElement.getBoundingClientRect().top >= startEndElement.endElement.getBoundingClientRect().top) {
                previousElement = getPreviousFileLi(startEndElement.endElement) as Element;
                if (previousElement) {
                    previousElement.classList.add("b3-list-item--focus");
                    previousElement.setAttribute("select-end", "true");
                    startEndElement.endElement.removeAttribute("select-end");
                }
            } else {
                startEndElement.endElement.classList.remove("b3-list-item--focus");
                startEndElement.endElement.removeAttribute("select-end");
                previousElement = getPreviousFileLi(startEndElement.endElement) as Element;
                if (previousElement) {
                    previousElement.setAttribute("select-end", "true");
                }
            }
            if (previousElement) {
                const previousRect = previousElement.getBoundingClientRect();
                const fileRect = files.element.getBoundingClientRect();
                if (previousRect.top < fileRect.top || previousRect.bottom > fileRect.bottom) {
                    previousElement.scrollIntoView(previousRect.top < fileRect.top);
                }
            }
        } else if (event.key === "ArrowDown") {
            const startEndElement = getStartEndElement(liElements);
            let nextElement: Element;
            if (startEndElement.startElement.getBoundingClientRect().top <= startEndElement.endElement.getBoundingClientRect().top) {
                nextElement = getNextFileLi(startEndElement.endElement) as Element;
                if (nextElement) {
                    nextElement.classList.add("b3-list-item--focus");
                    nextElement.setAttribute("select-end", "true");
                    startEndElement.endElement.removeAttribute("select-end");
                }
            } else {
                startEndElement.endElement.classList.remove("b3-list-item--focus");
                startEndElement.endElement.removeAttribute("select-end");
                nextElement = getNextFileLi(startEndElement.endElement) as Element;
                if (nextElement) {
                    nextElement.setAttribute("select-end", "true");
                }
            }
            if (nextElement) {
                const nextRect = nextElement.getBoundingClientRect();
                const fileRect = files.element.getBoundingClientRect();
                if (nextRect.top < fileRect.top || nextRect.bottom > fileRect.bottom) {
                    nextElement.scrollIntoView(nextRect.top < fileRect.top);
                }
            }
        }
        return;
    } else if (!isCtrl(event)) {
        files.element.querySelector('[select-end="true"]')?.removeAttribute("select-end");
        files.element.querySelector('[select-start="true"]')?.removeAttribute("select-start");
        if ((event.key === "ArrowRight" && !liElements[0].querySelector(".b3-list-item__arrow--open") && !liElements[0].querySelector(".b3-list-item__toggle").classList.contains("fn__hidden")) ||
            (event.key === "ArrowLeft" && liElements[0].querySelector(".b3-list-item__arrow--open"))) {
            files.getLeaf(liElements[0], notebookId);
            liElements.forEach((item, index) => {
                if (index !== 0) {
                    item.classList.remove("b3-list-item--focus");
                }
            });
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowLeft") {
            let parentElement = liElements[0].parentElement.previousElementSibling;
            if (parentElement) {
                if (parentElement.tagName !== "LI") {
                    parentElement = files.element.querySelector(".b3-list-item");
                }
                liElements.forEach((item) => {
                    item.classList.remove("b3-list-item--focus");
                });
                parentElement.classList.add("b3-list-item--focus");
                const parentRect = parentElement.getBoundingClientRect();
                const fileRect = files.element.getBoundingClientRect();
                if (parentRect.top < fileRect.top || parentRect.bottom > fileRect.bottom) {
                    parentElement.scrollIntoView(parentRect.top < fileRect.top);
                }
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            let nextElement = liElements[0];
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
                liElements.forEach((item) => {
                    item.classList.remove("b3-list-item--focus");
                });
                nextElement.classList.add("b3-list-item--focus");
                const nextRect = nextElement.getBoundingClientRect();
                const fileRect = files.element.getBoundingClientRect();
                if (nextRect.top < fileRect.top || nextRect.bottom > fileRect.bottom) {
                    nextElement.scrollIntoView(nextRect.top < fileRect.top);
                }
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowUp") {
            let previousElement = liElements[0];
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
                liElements.forEach((item) => {
                    item.classList.remove("b3-list-item--focus");
                });
                previousElement.classList.add("b3-list-item--focus");
                const previousRect = previousElement.getBoundingClientRect();
                const fileRect = files.element.getBoundingClientRect();
                if (previousRect.top < fileRect.top || previousRect.bottom > fileRect.bottom) {
                    previousElement.scrollIntoView(previousRect.top < fileRect.top);
                }
            }
            event.preventDefault();
            return true;
        }
    }
    if (event.key === "Delete" || (event.key === "Backspace" && isMac())) {
        window.siyuan.menus.menu.remove();
        deleteFiles(liElements);
        return true;
    }
    if (event.key === "Enter") {
        window.siyuan.menus.menu.remove();
        liElements.forEach(item => {
            if (item.getAttribute("data-type") === "navigation-file") {
                openFileById({app, id: item.getAttribute("data-node-id"), action: [Constants.CB_GET_FOCUS]});
            } else {
                const itemTopULElement = hasTopClosestByTag(item, "UL");
                if (itemTopULElement) {
                    files.getLeaf(item, itemTopULElement.getAttribute("data-url"));
                }
            }
        });
        return true;
    }
};

const panelTreeKeydown = (app: App, event: KeyboardEvent) => {
    // 面板折叠展开操作
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        hasClosestByAttribute(target, "contenteditable", null) ||
        hasClosestByClassName(target, "protyle", true)) {
        return false;
    }

    let activePanelElement = document.querySelector(".layout__tab--active");
    if (!activePanelElement) {
        Array.from(document.querySelectorAll(".layout__wnd--active .layout-tab-container > div")).find(item => {
            if (!item.classList.contains("fn__none") && item.className.indexOf("sy__") > -1) {
                activePanelElement = item;
                return true;
            }
        });
    }
    if (!activePanelElement) {
        return false;
    }
    if (activePanelElement.className.indexOf("sy__") === -1) {
        return false;
    }

    let matchCommand = false;
    app.plugins.find(item => {
        item.commands.find(command => {
            if (command.dockCallback && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                command.dockCallback(activePanelElement as HTMLElement);
                return true;
            }
        });
        if (matchCommand) {
            return true;
        }
    });
    if (matchCommand) {
        return true;
    }
    if (!matchHotKey(window.siyuan.config.keymap.editor.general.collapse.custom, event) &&
        !matchHotKey(window.siyuan.config.keymap.editor.general.expand.custom, event) &&
        !event.key.startsWith("Arrow") && event.key !== "Enter") {
        return false;
    }
    if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.collapse.custom, event)) {
        const collapseElement = activePanelElement.querySelector('.block__icon[data-type="collapse"]');
        if (collapseElement) {
            collapseElement.dispatchEvent(new CustomEvent("click"));
            event.preventDefault();
            return true;
        }
    }
    if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.expand.custom, event)) {
        const expandElement = activePanelElement.querySelector('.block__icon[data-type="expand"]');
        if (expandElement) {
            expandElement.dispatchEvent(new CustomEvent("click"));
            event.preventDefault();
            return true;
        }
    }
    if (activePanelElement.classList.contains("sy__inbox") ||
        activePanelElement.classList.contains("sy__globalGraph") ||
        activePanelElement.classList.contains("sy__graph")) {
        return false;
    }
    const model = (getInstanceById(activePanelElement.getAttribute("data-id"), window.siyuan.layout.layout) as Tab)?.model;
    if (!model) {
        return false;
    }
    let activeItemElement = activePanelElement.querySelector(".b3-list-item--focus");
    if (!activeItemElement) {
        activeItemElement = activePanelElement.querySelector(".b3-list .b3-list-item");
        if (activeItemElement) {
            activeItemElement.classList.add("b3-list-item--focus");
        }
        return false;
    }

    let tree = (model as Backlink).tree;
    if (activeItemElement.parentElement.parentElement.classList.contains("backlinkMList")) {
        tree = (model as Backlink).mTree;
    }
    if (!tree) {
        return false;
    }
    if (event.key === "Enter") {
        tree.click(activeItemElement);
        event.preventDefault();
        return true;
    }
    const arrowElement = activeItemElement.querySelector(".b3-list-item__arrow");
    if ((event.key === "ArrowRight" && !arrowElement.classList.contains("b3-list-item__arrow--open") && !arrowElement.parentElement.classList.contains("fn__hidden")) ||
        (event.key === "ArrowLeft" && arrowElement.classList.contains("b3-list-item__arrow--open") && !arrowElement.parentElement.classList.contains("fn__hidden"))) {
        tree.toggleBlocks(activeItemElement);
        event.preventDefault();
        return true;
    }
    const ulElement = hasClosestByClassName(activeItemElement, "b3-list");
    if (!ulElement) {
        return false;
    }
    if (event.key === "ArrowLeft") {
        let parentElement = activeItemElement.parentElement.previousElementSibling;
        if (parentElement) {
            if (parentElement.tagName !== "LI") {
                parentElement = ulElement.querySelector(".b3-list-item");
            }
            activeItemElement.classList.remove("b3-list-item--focus");
            parentElement.classList.add("b3-list-item--focus");
            const parentRect = parentElement.getBoundingClientRect();
            const scrollRect = ulElement.parentElement.getBoundingClientRect();
            if (parentRect.top < scrollRect.top || parentRect.bottom > scrollRect.bottom) {
                parentElement.scrollIntoView(parentRect.top < scrollRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        let nextElement = activeItemElement;
        while (nextElement) {
            if (nextElement.nextElementSibling) {
                if (nextElement.nextElementSibling.tagName === "UL") {
                    if (nextElement.nextElementSibling.classList.contains("fn__none")) {   // 遇到折叠内容
                        if (nextElement.nextElementSibling.nextElementSibling) {
                            nextElement = nextElement.nextElementSibling.nextElementSibling;
                        }
                    } else {
                        nextElement = nextElement.nextElementSibling.firstElementChild;
                    }
                } else if (nextElement.nextElementSibling.classList.contains("protyle")) { // backlink
                    if (nextElement.nextElementSibling.nextElementSibling) {
                        nextElement = nextElement.nextElementSibling.nextElementSibling;
                    }
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
        if (nextElement.classList.contains("b3-list-item") && !nextElement.classList.contains("b3-list-item--focus")) {
            activeItemElement.classList.remove("b3-list-item--focus");
            nextElement.classList.add("b3-list-item--focus");
            const nextRect = nextElement.getBoundingClientRect();
            const scrollRect = ulElement.parentElement.getBoundingClientRect();
            if (nextRect.top < scrollRect.top || nextRect.bottom > scrollRect.bottom) {
                nextElement.scrollIntoView(nextRect.top < scrollRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    if (event.key === "ArrowUp") {
        let previousElement = activeItemElement;
        while (previousElement) {
            if (previousElement.previousElementSibling) {
                if (previousElement.previousElementSibling.tagName === "LI") {
                    previousElement = previousElement.previousElementSibling;
                } else if (previousElement.previousElementSibling.classList.contains("protyle")) {
                    if (previousElement.previousElementSibling.previousElementSibling) {
                        previousElement = previousElement.previousElementSibling.previousElementSibling;
                    }
                } else if (previousElement.previousElementSibling.tagName === "UL" && previousElement.previousElementSibling.classList.contains("fn__none")) {   // 遇到折叠内容
                    if (previousElement.previousElementSibling.previousElementSibling) {
                        previousElement = previousElement.previousElementSibling.previousElementSibling;
                    }
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
        if (previousElement.classList.contains("b3-list-item") && !previousElement.classList.contains("b3-list-item--focus")) {
            activeItemElement.classList.remove("b3-list-item--focus");
            previousElement.classList.add("b3-list-item--focus");
            const previousRect = previousElement.getBoundingClientRect();
            const scrollRect = ulElement.parentElement.getBoundingClientRect();
            if (previousRect.top < scrollRect.top || previousRect.bottom > scrollRect.bottom) {
                previousElement.scrollIntoView(previousRect.top < scrollRect.top);
            }
        }
        event.preventDefault();
        return true;
    }
    return false;
};

let switchDialog: Dialog;
export const windowKeyDown = (app: App, event: KeyboardEvent) => {
    if (document.querySelector(".av__mask") || document.getElementById("errorLog") || event.isComposing) {
        return;
    }
    const target = event.target as HTMLElement;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
        !["INPUT", "TEXTAREA"].includes(target.tagName) &&
        ["0", "1", "2", "3", "4", "j", "k", "l", ";", "s", " ", "p"].includes(event.key.toLowerCase())) {
        let cardElement: Element;
        window.siyuan.dialogs.find(item => {
            if (item.element.getAttribute("data-key") === window.siyuan.config.keymap.general.riffCard.custom) {
                cardElement = item.element;
                return true;
            }
        });
        if (!cardElement) {
            cardElement = document.querySelector(`.layout__wnd--active div[data-key="${window.siyuan.config.keymap.general.riffCard.custom}"]:not(.fn__none)`);
        }
        if (cardElement) {
            event.preventDefault();
            cardElement.dispatchEvent(new CustomEvent("click", {detail: event.key.toLowerCase()}));
            return;
        }
    }

    // 仅处理以下快捷键操作
    if (!event.ctrlKey && !isCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey &&
        !/^F\d{1,2}$/.test(event.key) && event.key.indexOf("Arrow") === -1 && event.key !== "Enter" && event.key !== "Backspace" && event.key !== "Delete") {
        return;
    }

    if (!event.altKey && !event.shiftKey && isCtrl(event)) {
        if (event.key === "Meta" || event.key === "Control" || event.ctrlKey || event.metaKey) {
            window.siyuan.ctrlIsPressed = true;
            if ((event.key === "Meta" || event.key === "Control") &&
                window.siyuan.config.editor.floatWindowMode === 1 && !event.repeat) {
                showPopover(app);
            }
        } else {
            window.siyuan.ctrlIsPressed = false;
        }
    }

    if (!event.altKey && event.shiftKey && !isCtrl(event)) {
        if (event.key === "Shift") {
            window.siyuan.shiftIsPressed = true;
            if (!event.repeat) {
                showPopover(app, true);
            }
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

    if (switchDialog && event.ctrlKey && !event.metaKey && event.key.startsWith("Arrow")) {
        dialogArrow(app, switchDialog.element, event);
        return;
    }

    const isTabWindow = isWindow();
    if (event.ctrlKey && !event.metaKey && event.key === "Tab") {
        if (switchDialog && switchDialog.element.parentElement) {
            return;
        }
        let tabHtml = "";
        let currentTabElement = document.querySelector(".layout__wnd--active .layout-tab-bar > .item--focus");
        if (!currentTabElement) {
            currentTabElement = document.querySelector(".layout-tab-bar > .item--focus");
        }
        if (currentTabElement) {
            const currentId = currentTabElement.getAttribute("data-id");
            getAllTabs().sort((itemA, itemB) => {
                return itemA.headElement.getAttribute("data-activetime") > itemB.headElement.getAttribute("data-activetime") ? -1 : 1;
            }).forEach((item, index) => {
                let icon = `<svg class="b3-list-item__graphic"><use xlink:href="#${item.icon}"></use></svg>`;
                let rootId = "";
                const initData = item.headElement.getAttribute("data-initdata");
                if (item.model instanceof Editor) {
                    rootId = ` data-node-id="${item.model.editor.protyle.block.rootID}"`;
                    icon = unicode2Emoji(item.docIcon || Constants.SIYUAN_IMAGE_FILE, "b3-list-item__graphic", true);
                } else if (initData) {
                    const initDataObj = JSON.parse(initData);
                    if (initDataObj.instance === "Editor") {
                        rootId = ` data-node-id="${initDataObj.rootId}"`;
                        icon = unicode2Emoji(item.docIcon || Constants.SIYUAN_IMAGE_FILE, "b3-list-item__graphic", true);
                    }
                }
                tabHtml += `<li data-index="${index}" data-id="${item.id}"${rootId} class="b3-list-item${currentId === item.id ? " b3-list-item--focus" : ""}"${currentId === item.id ? ' data-original="true"' : ""}>${icon}<span class="b3-list-item__text">${escapeHtml(item.title)}</span></li>`;
            });
        }
        let dockHtml = "";
        if (!isTabWindow) {
            dockHtml = `<ul class="b3-list b3-list--background" style="overflow: auto;width: 200px;">
<li data-type="riffCard" data-index="0" class="b3-list-item${!tabHtml ? " b3-list-item--focus" : ""}">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconRiffCard"></use></svg>
    <span class="b3-list-item__text">${window.siyuan.languages.riffCard}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(window.siyuan.config.keymap.general.riffCard.custom)}</span>
</li>`;
            getAllDocks().forEach((item, index) => {
                dockHtml += `<li data-type="${item.type}" data-index="${index + 1}" class="b3-list-item">
    <svg class="b3-list-item__graphic"><use xlink:href="#${item.icon}"></use></svg>
    <span class="b3-list-item__text">${item.title}</span>
    <span class="b3-list-item__meta">${updateHotkeyTip(item.hotkey || "")}</span>
</li>`;
            });
            dockHtml = dockHtml + "</ul>";
        }
        hideElements(["dialog"]);
        switchDialog = new Dialog({
            title: window.siyuan.languages.switchTab,
            content: `<div class="fn__flex-column switch-doc">
    <div class="fn__hr"><input style="opacity: 0;height: 1px;box-sizing: border-box"></div>
    <div class="fn__flex" style="overflow:auto;">${dockHtml}
        <ul${!isTabWindow ? "" : ' style="border-left:0"'} class="b3-list b3-list--background fn__flex-1">${tabHtml}</ul>
    </div>
    <div class="switch-doc__path"></div>
</div>`,
        });
        switchDialog.element.setAttribute("data-key", "⌃⇥");
        // 需移走光标，否则编辑器会继续监听并执行按键操作
        switchDialog.element.querySelector("input").focus();
        if (isMac()) {
            switchDialog.element.addEventListener("contextmenu", (event) => {
                switchDialogEvent(app, event);
            });
        }
        switchDialog.element.addEventListener("click", (event) => {
            switchDialogEvent(app, event);
        });
        return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
        (event.key.startsWith("Arrow") || event.key === "Enter")) {
        const openRecentDocsDialog = window.siyuan.dialogs.find(item => {
            if (item.element.getAttribute("data-key") === window.siyuan.config.keymap.general.recentDocs.custom) {
                return true;
            }
        });
        if (openRecentDocsDialog) {
            event.preventDefault();
            dialogArrow(app, openRecentDocsDialog.element, event);
            return;
        }
    }

    if (matchHotKey(window.siyuan.config.keymap.general.recentDocs.custom, event)) {
        const openRecentDocsDialog = window.siyuan.dialogs.find(item => {
            if (item.element.getAttribute("data-key") === window.siyuan.config.keymap.general.recentDocs.custom) {
                return true;
            }
        });
        if (openRecentDocsDialog) {
            hideElements(["dialog"]);
            return;
        }
        openRecentDocs();
        event.preventDefault();
        return;
    }

    if (bindMenuKeydown(event)) {
        event.preventDefault();
        return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const viewCardsDialog = window.siyuan.dialogs.find(item => {
            if (item.element.getAttribute("data-key") === "viewCards") {
                return true;
            }
        });
        if (viewCardsDialog) {
            viewCardsDialog.element.dispatchEvent(new CustomEvent("click", {detail: event.key.toLowerCase()}));
            event.preventDefault();
            return;
        }
    }

    /// #if !BROWSER
    if (matchHotKey("⌘=", event) && !hasClosestByClassName(target, "pdf__outer")) {
        setZoom("zoomIn");
        event.preventDefault();
        return;
    }
    if (matchHotKey("⌘0", event)) {
        setZoom("restore");
        event.preventDefault();
        return;
    }
    if (matchHotKey("⌘-", event) && !hasClosestByClassName(target, "pdf__outer")) {
        setZoom("zoomOut");
        event.preventDefault();
        return;
    }
    /// #endif

    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.syncNow.custom, event)) {
        event.preventDefault();
        syncGuide(app);
        return;
    }
    if (matchHotKey(window.siyuan.config.keymap.general.commandPanel.custom, event)) {
        event.preventDefault();
        commandPanel(app);
        return;
    }
    if (matchHotKey(window.siyuan.config.keymap.general.editMode.custom, event)) {
        event.preventDefault();
        editor.setReadonly();
        return;
    }
    if (matchHotKey(window.siyuan.config.keymap.general.lockScreen.custom, event)) {
        lockScreen();
        event.preventDefault();
        return;
    }
    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.dataHistory.custom, event)) {
        if (!window.siyuan.config.readonly) {
            openHistory(app);
        }
        event.preventDefault();
        return;
    }
    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.toggleDock.custom, event)) {
        toggleDockBar(document.querySelector("#barDock use"));
        event.preventDefault();
        return;
    }
    if (!isTabWindow && !window.siyuan.config.readonly && matchHotKey(window.siyuan.config.keymap.general.config.custom, event)) {
        openSetting(app);
        event.preventDefault();
        return;
    }
    if (matchHotKey("⌘A", event) && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
        event.preventDefault();
        return;
    }
    const matchDock = getAllDocks().find(item => {
        if (matchHotKey(item.hotkey, event)) {
            getDockByType(item.type).toggleModel(item.type);
            event.preventDefault();
            return true;
        }
    });
    if (matchDock) {
        return;
    }
    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.riffCard.custom, event)) {
        openCard(app);
        if (document.activeElement) {
            (document.activeElement as HTMLElement).blur();
        }
        event.preventDefault();
        return;
    }
    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.dailyNote.custom, event)) {
        newDailyNote();
        event.stopPropagation();
        event.preventDefault();
        return;
    }
    if (matchHotKey(window.siyuan.config.keymap.general.newFile.custom, event)) {
        newFile(app, undefined, undefined, undefined, true);
        event.preventDefault();
        return;
    }
    // https://github.com/siyuan-note/siyuan/issues/8913#issuecomment-1679720605
    const confirmElement = document.querySelector("#confirmDialogConfirmBtn");
    if (confirmElement) {
        if (event.key === "Enter") {
            confirmElement.dispatchEvent(new CustomEvent("click"));
            event.preventDefault();
            return;
        } else if (event.key === "Escape") {
            confirmElement.previousElementSibling.previousElementSibling.dispatchEvent(new CustomEvent("click"));
            event.preventDefault();
            return;
        }
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
            if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "true") {
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
            if ((item.targetElement || typeof item.x === "number") && item.element.getAttribute("data-pin") === "false" &&
                parseInt(item.element.getAttribute("data-level")) > (maxEditLevels[item.element.getAttribute("data-oid")] || 0)) {
                item.destroy();
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

    if (!isTabWindow && matchHotKey(window.siyuan.config.keymap.general.mainMenu.custom, event)) {
        workspaceMenu(app, document.querySelector("#barWorkspace").getBoundingClientRect());
        event.preventDefault();
        return;
    }

    if (matchHotKey(window.siyuan.config.keymap.general.goForward.custom, event)) {
        goForward(app);
        event.preventDefault();
        return;
    }

    if (matchHotKey(window.siyuan.config.keymap.general.goBack.custom, event)) {
        goBack(app);
        event.preventDefault();
        return;
    }

    // close tab
    if (matchHotKey(window.siyuan.config.keymap.general.closeTab.custom, event) && !event.repeat) {
        event.preventDefault();
        let activeTabElement = document.querySelector(".layout__tab--active");
        if (activeTabElement && activeTabElement.getBoundingClientRect().width > 0) {
            let type = "";
            Array.from(activeTabElement.classList).find(item => {
                if (item.startsWith("sy__")) {
                    type = item.replace("sy__", "");
                    return true;
                }
            });
            if (type) {
                getDockByType(type)?.toggleModel(type, false, true);
            }
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
                return true;
            }
        });
        return;
    }

    if (matchHotKey(window.siyuan.config.keymap.general.stickSearch.custom, event)) {
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            openGlobalSearch(app, range.toString(), false);
        } else {
            openGlobalSearch(app, "", false);
        }
        event.preventDefault();
        return;
    }

    if (editKeydown(app, event)) {
        return;
    }

    // 文件树的操作
    if (!isTabWindow && fileTreeKeydown(app, event)) {
        return;
    }

    // 面板的操作
    if (!isTabWindow && panelTreeKeydown(app, event)) {
        return;
    }

    let matchCommand = false;
    app.plugins.find(item => {
        item.commands.find(command => {
            if (command.callback &&
                !command.fileTreeCallback && !command.editorCallback && !command.dockCallback && !command.globalCallback
                && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                command.callback();
                return true;
            }
        });
        if (matchCommand) {
            return true;
        }
    });
    if (matchCommand) {
        event.stopPropagation();
        event.preventDefault();
        return true;
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
            openSearch({
                app,
                hotkey: searchKey,
                key: range.toString(),
            });
        } else {
            openSearch({
                app,
                hotkey: searchKey,
            });
        }
        event.preventDefault();
        return;
    }

    // https://github.com/siyuan-note/insider/issues/445
    if (matchHotKey("⌘S", event)) {
        event.preventDefault();
        return true;
    }
};

export const sendGlobalShortcut = (app: App) => {
    /// #if !BROWSER
    const hotkeys = [window.siyuan.config.keymap.general.toggleWin.custom];
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            if (command.globalCallback) {
                hotkeys.push(command.customHotkey);
            }
        });
    });
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
        languages: window.siyuan.languages["_trayMenu"],
        id: getCurrentWindow().id,
        hotkeys
    });
    /// #endif
};
