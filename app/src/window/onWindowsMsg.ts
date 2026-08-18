import {getInstanceById} from "../layout/util";
import {Tab} from "../layout/Tab";
import {lockScreen} from "../dialog/processSystem";
import type {App} from "../index";
import {clearTabDragPreview} from "../layout/tabDrag";

const closeTab = (ipcData: IWebSocketData) => {
    const tab = getInstanceById(ipcData.data);
    if (tab && tab instanceof Tab) {
        tab.parent.removeTab(ipcData.data);
    }
};
export const onWindowsMsg = (ipcData: IWebSocketData, app: App) => {
    switch (ipcData.cmd) {
        case "closetab":
            closeTab(ipcData);
            break;
        case "setTabDragData":
            window.siyuan.dragTab = ipcData.data as ITabDragData;
            break;
        case "resetTabsStyle":
            // data: addRegionStyle, rmDragStyle, rmDragStyleRegionStyle
            if (ipcData.data === "rmDragStyle") {
                clearTabDragPreview();
                window.siyuan.dragTab = undefined;
            } else {
                document.querySelectorAll(".layout-tab-bar--readonly .fn__flex-1").forEach((item: HTMLElement) => {
                    if (item.getBoundingClientRect().top <= 6) {
                        if (ipcData.data === "addRegionStyle") {
                            (item.style as CSSStyleDeclarationElectron).WebkitAppRegion = "drag";
                        } else if (ipcData.data === "removeRegionStyle") {
                            (item.style as CSSStyleDeclarationElectron).WebkitAppRegion = "";
                        }
                    }
                });
            }
            break;
        case "lockscreenByMode":
            if (window.siyuan.config.system.lockScreenMode === 1) {
                lockScreen(app);
            }
            break;
    }
};
