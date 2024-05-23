import {newDailyNote} from "../../../util/mount";
import {openHistory} from "../../../history/history";
import {Editor} from "../../../editor";
/// #if MOBILE
import {openDock} from "../../../mobile/dock/util";
import {popMenu} from "../../../mobile/menu";
import {popSearch} from "../../../mobile/menu/search";
import {getRecentDocs} from "../../../mobile/menu/getRecentDocs";
/// #else
import {openNewWindow} from "../../../window/openNewWindow";
import {toggleDockBar} from "../../../layout/dock/util";
import {openGlobalSearch} from "../../../search/util";
import {workspaceMenu} from "../../../menus/workspace";
import {isWindow} from "../../../util/functions";
import {openRecentDocs} from "../../../business/openRecentDocs";
import {openSearch} from "../../../search/spread";
import {goBack, goForward} from "../../../util/backForward";
import {getAllTabs, getAllWnds} from "../../../layout/getAll";
import {getInstanceById} from "../../../layout/util";
import {
    closeTabByType,
    copyTab,
    getActiveTab,
    getDockByType,
    resizeTabs,
    switchTabByIndex
} from "../../../layout/tabUtil";
import {openSetting} from "../../../config";
import {Tab} from "../../../layout/Tab";
import {Files} from "../../../layout/dock/Files";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {App} from "../../../index";
import {Constants} from "../../../constants";
import {setReadOnly} from "../../../config/util/setReadOnly";
import {lockScreen} from "../../../dialog/processSystem";
import {newFile} from "../../../util/newFile";
import {openCard} from "../../../card/openCard";
import {syncGuide} from "../../../sync/syncGuide";
import {Wnd} from "../../../layout/Wnd";
import {unsplitWnd} from "../../../menus/tab";

const selectOpenTab = () => {
    /// #if MOBILE
    if (window.siyuan.mobile.editor?.protyle) {
        openDock("file");
        window.siyuan.mobile.files.selectItem(window.siyuan.mobile.editor.protyle.notebookId, window.siyuan.mobile.editor.protyle.path);
    }
    /// #else
    const dockFile = getDockByType("file");
    if (!dockFile) {
        return false;
    }
    const files = dockFile.data.file as Files;
    const element = document.querySelector(".layout__wnd--active > .fn__flex > .layout-tab-bar > .item--focus") ||
        document.querySelector("ul.layout-tab-bar > .item--focus");
    if (element) {
        const tab = getInstanceById(element.getAttribute("data-id")) as Tab;
        if (tab && tab.model instanceof Editor) {
            tab.model.editor.protyle.wysiwyg.element.blur();
            tab.model.editor.protyle.title.editElement.blur();
            files.selectItem(tab.model.editor.protyle.notebookId, tab.model.editor.protyle.path);
        }
    }
    dockFile.toggleModel("file", true);
    /// #endif
};

export const globalCommand = (command: string, app: App) => {
    /// #if MOBILE
    switch (command) {
        case "fileTree":
            openDock("file");
            return true;
        case "outline":
        case "bookmark":
        case "tag":
        case "inbox":
            openDock(command);
            return true;
        case "backlinks":
            openDock("backlink");
            return true;
        case "mainMenu":
            popMenu();
            return true;
        case "globalSearch":
            popSearch(app);
            return true;
        case "recentDocs":
            getRecentDocs(app);
            return true;
    }
    /// #else
    switch (command) {
        case "fileTree":
            getDockByType("file").toggleModel("file");
            return true;
        case "outline":
            getDockByType("outline").toggleModel("outline");
            return true;
        case "bookmark":
        case "tag":
        case "inbox":
            getDockByType(command).toggleModel(command);
            return true;
        case "backlinks":
            getDockByType("backlink").toggleModel("backlink");
            return true;
        case "graphView":
            getDockByType("graph").toggleModel("graph");
            return true;
        case "globalGraph":
            getDockByType("globalGraph").toggleModel("globalGraph");
            return true;
        case "config":
            openSetting(app);
            return true;
        case "globalSearch":
            openSearch({
                app,
                hotkey: Constants.DIALOG_GLOBALSEARCH,
                key: (getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : document.createRange()).toString()
            });
            return true;
        case "stickSearch":
            openGlobalSearch(app, (getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : document.createRange()).toString(), true);
            return true;
        case "goBack":
            goBack(app);
            return true;
        case "goForward":
            goForward(app);
            return true;
        case "goToTab1":
            switchTabByIndex(0);
            return true;
        case "goToTab2":
            switchTabByIndex(1);
            return true;
        case "goToTab3":
            switchTabByIndex(2);
            return true;
        case "goToTab4":
            switchTabByIndex(3);
            return true;
        case "goToTab5":
            switchTabByIndex(4);
            return true;
        case "goToTab6":
            switchTabByIndex(5);
            return true;
        case "goToTab7":
            switchTabByIndex(6);
            return true;
        case "goToTab8":
            switchTabByIndex(7);
            return true;
        case "goToTab9":
            switchTabByIndex(-1);
            return true;
        case "goToTabNext":
            switchTabByIndex(-3);
            return true;
        case "goToTabPrev":
            switchTabByIndex(-2);
            return true;
        case "mainMenu":
            if (!isWindow()) {
                workspaceMenu(app, document.querySelector("#barWorkspace").getBoundingClientRect());
            }
            return true;
        case "recentDocs":
            openRecentDocs();
            return true;
        case "toggleDock":
            toggleDockBar(document.querySelector("#barDock use"));
            return true;
        case "toggleWin":
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_CMD, "hide");
            ipcRenderer.send(Constants.SIYUAN_CMD, "minimize");
            /// #endif
            return true;
    }
    if (command === "goToEditTabNext" || command === "goToEditTabPrev") {
        let currentTabElement = document.querySelector(".layout__wnd--active ul.layout-tab-bar > .item--focus");
        if (!currentTabElement) {
            currentTabElement = document.querySelector("ul.layout-tab-bar > .item--focus");
        }
        if (!currentTabElement) {
            return true;
        }
        const tabs = getAllTabs().sort((itemA, itemB) => {
            return itemA.headElement.getAttribute("data-activetime") > itemB.headElement.getAttribute("data-activetime") ? -1 : 1;
        });
        const currentId = currentTabElement.getAttribute("data-id");
        tabs.find((item, index) => {
            if (currentId === item.id) {
                let newItem: Tab;
                if (command === "goToEditTabPrev") {
                    if (index === 0) {
                        newItem = tabs[tabs.length - 1];
                    } else {
                        newItem = tabs[index - 1];
                    }
                } else {
                    if (index === tabs.length - 1) {
                        newItem = tabs[0];
                    } else {
                        newItem = tabs[index + 1];
                    }
                }
                const tab = getInstanceById(newItem.id) as Tab;
                tab.parent.switchTab(newItem.headElement);
                tab.parent.showHeading();
            }
        });
        return true;
    }
    if (command === "closeUnmodified") {
        const tab = getActiveTab(false);
        if (tab) {
            const unmodifiedTabs: Tab[] = [];
            tab.parent.children.forEach((item: Tab) => {
                const editor = item.model as Editor;
                if (!editor || (editor.editor?.protyle && !editor.editor?.protyle.updated)) {
                    unmodifiedTabs.push(item);
                }
            });
            if (unmodifiedTabs.length > 0) {
                closeTabByType(tab, "other", unmodifiedTabs);
            }
        }
        return true;
    }
    if (command === "unsplitAll") {
        unsplitWnd(window.siyuan.layout.centerLayout, window.siyuan.layout.centerLayout, false);
        return true;
    }
    if (command === "unsplit") {
        const tab = getActiveTab(false);
        if (tab) {
            let wndsTemp: Wnd[] = [];
            let layout = tab.parent.parent;
            while (layout.id !== window.siyuan.layout.centerLayout.id) {
                wndsTemp = [];
                getAllWnds(layout, wndsTemp);
                if (wndsTemp.length > 1) {
                    break;
                } else {
                    layout = layout.parent;
                }
            }
            unsplitWnd(tab.parent.parent.children[0], layout, true);
            resizeTabs();
        }
        return true;
    }
    if (command === "closeTab") {
        const activeTabElement = document.querySelector(".layout__tab--active");
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
            return true;
        }
        const tab = getActiveTab(false);
        if (tab) {
            tab.parent.removeTab(tab.id);
        }
        return true;
    }
    if (command === "closeOthers" || command === "closeAll") {
        const tab = getActiveTab(false);
        if (tab) {
            closeTabByType(tab, command);
        }
        return true;
    }
    if (command === "closeLeft" || command === "closeRight") {
        const tab = getActiveTab(false);
        if (tab) {
            const leftTabs: Tab[] = [];
            const rightTabs: Tab[] = [];
            let midIndex = -1;
            tab.parent.children.forEach((item: Tab, index: number) => {
                if (item.id === tab.id) {
                    midIndex = index;
                }
                if (midIndex === -1) {
                    leftTabs.push(item);
                } else if (index > midIndex) {
                    rightTabs.push(item);
                }
            });
            if (command === "closeLeft") {
                if (leftTabs.length > 0) {
                    closeTabByType(tab, "other", leftTabs);
                }
            } else {
                if (rightTabs.length > 0) {
                    closeTabByType(tab, "other", rightTabs);
                }
            }
        }
        return true;
    }
    if (command === "splitLR") {
        const tab = getActiveTab(false);
        if (tab) {
            tab.parent.split("lr").addTab(copyTab(app, tab));
        }
        return true;
    }
    if (command === "splitTB") {
        const tab = getActiveTab(false);
        if (tab) {
            tab.parent.split("tb").addTab(copyTab(app, tab));
        }
        return true;
    }
    if (command === "splitMoveB" || command === "splitMoveR") {
        const tab = getActiveTab(false);
        if (tab && tab.parent.children.length > 1) {
            const newWnd = tab.parent.split(command === "splitMoveB" ? "tb" : "lr");
            newWnd.headersElement.append(tab.headElement);
            newWnd.headersElement.parentElement.classList.remove("fn__none");
            newWnd.moveTab(tab);
            resizeTabs();
        }
        return true;
    }
    if (command === "tabToWindow") {
        const tab = getActiveTab(false);
        if (tab) {
            openNewWindow(tab);
        }
        return true;
    }
    /// #endif

    switch (command) {
        case "dailyNote":
            newDailyNote(app);
            return true;
        case "dataHistory":
            openHistory(app);
            return true;
        case "editReadonly":
            setReadOnly(!window.siyuan.config.editor.readOnly);
            return true;
        case "lockScreen":
            lockScreen(app);
            return true;
        case "newFile":
            newFile({
                app,
                useSavePath: true
            });
            return true;
        case "riffCard":
            openCard(app);
            return true;
        case "selectOpen1":
            selectOpenTab();
            return true;
        case "syncNow":
            syncGuide(app);
            return true;
    }

    return false;
};
