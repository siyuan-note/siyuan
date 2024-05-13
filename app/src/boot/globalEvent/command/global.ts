import {newDailyNote} from "../../../util/mount";
import {openHistory} from "../../../history/history";
import {Editor} from "../../../editor";
/// #if MOBILE
import {openDock} from "../../../mobile/dock/util";
import {popMenu} from "../../../mobile/menu";
/// #else
import {closeTabByType, getActiveTab, getDockByType} from "../../../layout/tabUtil";
import {openSetting} from "../../../config";
import {Tab} from "../../../layout/Tab";
/// #endif
import {App} from "../../../index";
import {editor} from "../../../config/editor";

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
            editor.setReadonly(!window.siyuan.config.editor.readOnly);
            return true;
    }

    return false
}
