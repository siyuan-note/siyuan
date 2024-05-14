import {newDailyNote} from "../../../util/mount";
import {openHistory} from "../../../history/history";
import {Editor} from "../../../editor";
/// #if MOBILE
import {openDock} from "../../../mobile/dock/util";
import {popMenu} from "../../../mobile/menu";
import {popSearch} from "../../../mobile/menu/search";
/// #else
import {openSearch} from "../../../search/spread";
import {goBack, goForward} from "../../../util/backForward";
import {getAllTabs} from "../../../layout/getAll";
import {getInstanceById} from "../../../layout/util";
import {closeTabByType, getActiveTab, getDockByType, switchTabByIndex} from "../../../layout/tabUtil";
import {openSetting} from "../../../config";
import {Tab} from "../../../layout/Tab";
/// #endif
import {App} from "../../../index";
import {Constants} from "../../../constants";
import {setReadOnly} from "../../../config/util/setReadOnly";

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
        case "config":
            popMenu();
            return true;
        case "globalSearch":
            popSearch(app);
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
            });
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
    }

    return false;
};
