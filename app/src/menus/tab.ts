import {Tab} from "../layout/Tab";
import {MenuItem} from "./Menu";
import {Editor} from "../editor";
import {closeTabByType, copyTab, resizeTabs} from "../layout/tabUtil";
/// #if !BROWSER
import {openNewWindow} from "../window/openNewWindow";
/// #endif
import {copySubMenu} from "./commonMenuItem";
import {App} from "../index";
import {Layout} from "../layout";
import {Wnd} from "../layout/Wnd";
import {getAllWnds} from "../layout/getAll";
import {Asset} from "../asset";
import {writeText} from "../protyle/util/compatibility";

const closeMenu = (tab: Tab) => {
    const unmodifiedTabs: Tab[] = [];
    const leftTabs: Tab[] = [];
    const rightTabs: Tab[] = [];
    let midIndex = -1;
    tab.parent.children.forEach((item: Tab, index: number) => {
        const editor = item.model as Editor;
        if (!editor || (editor.editor?.protyle && !editor.editor?.protyle.updated)) {
            unmodifiedTabs.push(item);
        }
        if (item.id === tab.id) {
            midIndex = index;
        }
        if (midIndex === -1) {
            leftTabs.push(item);
        } else if (index > midIndex) {
            rightTabs.push(item);
        }
    });

    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconClose",
        label: window.siyuan.languages.close,
        accelerator: window.siyuan.config.keymap.general.closeTab.custom,
        click: () => {
            tab.parent.removeTab(tab.id);
        }
    }).element);
    if (tab.parent.children.length > 1) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.closeOthers,
            accelerator: window.siyuan.config.keymap.general.closeOthers.custom,
            click() {
                closeTabByType(tab, "closeOthers");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.closeAll,
            accelerator: window.siyuan.config.keymap.general.closeAll.custom,
            click() {
                closeTabByType(tab, "closeAll");
            }
        }).element);
        if (unmodifiedTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeUnmodified,
                accelerator: window.siyuan.config.keymap.general.closeUnmodified.custom,
                click() {
                    closeTabByType(tab, "other", unmodifiedTabs);
                }
            }).element);
        }
        if (leftTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeLeft,
                accelerator: window.siyuan.config.keymap.general.closeLeft.custom,
                click: async () => {
                    closeTabByType(tab, "other", leftTabs);
                }
            }).element);
        }
        if (rightTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeRight,
                accelerator: window.siyuan.config.keymap.general.closeRight.custom,
                click() {
                    closeTabByType(tab, "other", rightTabs);
                }
            }).element);
        }
    }
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
};

const splitSubMenu = (app: App, tab: Tab) => {
    const subMenus: IMenu[] = [{
        icon: "iconSplitLR",
        accelerator: window.siyuan.config.keymap.general.splitLR.custom,
        label: window.siyuan.languages.splitLR,
        click: () => {
            tab.parent.split("lr").addTab(copyTab(app, tab));
        }
    }];
    if (tab.parent.children.length > 1) {
        subMenus.push({
            icon: "iconLayoutRight",
            accelerator: window.siyuan.config.keymap.general.splitMoveR.custom,
            label: window.siyuan.languages.splitMoveR,
            click: () => {
                const newWnd = tab.parent.split("lr");
                newWnd.headersElement.append(tab.headElement);
                newWnd.headersElement.parentElement.classList.remove("fn__none");
                newWnd.moveTab(tab);
                resizeTabs();
            }
        });
    }
    subMenus.push({
        icon: "iconSplitTB",
        accelerator: window.siyuan.config.keymap.general.splitTB.custom,
        label: window.siyuan.languages.splitTB,
        click: () => {
            tab.parent.split("tb").addTab(copyTab(app, tab));
        }
    });

    if (tab.parent.children.length > 1) {
        subMenus.push({
            icon: "iconLayoutBottom",
            accelerator: window.siyuan.config.keymap.general.splitMoveB.custom,
            label: window.siyuan.languages.splitMoveB,
            click: () => {
                const newWnd = tab.parent.split("tb");
                newWnd.headersElement.append(tab.headElement);
                newWnd.headersElement.parentElement.classList.remove("fn__none");
                newWnd.moveTab(tab);
                resizeTabs();
            }
        });
    }
    let wndsTemp: Wnd[] = [];
    getAllWnds(window.siyuan.layout.centerLayout, wndsTemp);
    if (wndsTemp.length > 1) {
        subMenus.push({
            label: window.siyuan.languages.unsplit,
            accelerator: window.siyuan.config.keymap.general.unsplit.custom,
            click: () => {
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
        });
        subMenus.push({
            label: window.siyuan.languages.unsplitAll,
            accelerator: window.siyuan.config.keymap.general.unsplitAll.custom,
            click: () => {
                unsplitWnd(window.siyuan.layout.centerLayout, window.siyuan.layout.centerLayout, false);
                resizeTabs();
            }
        });
    }
    return subMenus;
};

export const initTabMenu = (app: App, tab: Tab) => {
    window.siyuan.menus.menu.remove();
    closeMenu(tab);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.split,
        submenu: splitSubMenu(app, tab)
    }).element);
    const model = tab.model;
    let rootId: string;
    if ((model && model instanceof Editor)) {
        rootId = model.editor.protyle.block.rootID;
    } else {
        const initData = tab.headElement.getAttribute("data-initdata");
        if (initData) {
            const initDataObj = JSON.parse(initData);
            if (initDataObj && initDataObj.instance === "Editor") {
                rootId = initDataObj.rootId || initDataObj.blockId;
            }
        }
    }
    if (rootId) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(rootId, false)
        }).element);
    } else if (model && model instanceof Asset) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            click() {
                writeText(`[${model.parent.title}](${model.path})`);
            }
        }).element);
    }
    if (tab.headElement.classList.contains("item--pin")) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.unpin,
            icon: "iconUnpin",
            click: () => {
                tab.unpin();
            }
        }).element);
    } else {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.pin,
            icon: "iconPin",
            click: () => {
                tab.pin();
            }
        }).element);
    }
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.tabToWindow,
        accelerator: window.siyuan.config.keymap.general.tabToWindow.custom,
        icon: "iconOpenWindow",
        click: () => {
            openNewWindow(tab);
        }
    }).element);
    /// #endif
    return window.siyuan.menus.menu;
};

export const unsplitWnd = (target: Wnd | Layout, layout: Layout, onlyWnd: boolean) => {
    let wnd: Wnd = target as Wnd;
    while (wnd instanceof Layout) {
        wnd = wnd.children[0] as Wnd;
    }
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Layout && !onlyWnd) {
            unsplitWnd(wnd, item, onlyWnd);
        } else if (item instanceof Wnd && item.id !== wnd.id && item.children.length > 0) {
            for (let j = 0; j < item.children.length; j++) {
                const tab = item.children[j];
                wnd.headersElement.append(tab.headElement);
                wnd.moveTab(tab);
                j--;
            }
            i--;
        }
    }
};
