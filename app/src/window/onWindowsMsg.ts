import {exportLayout, getInstanceById} from "../layout/util";
import {Tab} from "../layout/Tab";
import {fetchPost} from "../util/fetch";
import {redirectToCheckAuth} from "../util/pathName";

const closeTab = (ipcData: IWebSocketData) => {
    const tab = getInstanceById(ipcData.data);
    if (tab && tab instanceof Tab) {
        tab.parent.removeTab(ipcData.data);
    }
};
export const onWindowsMsg = (ipcData: IWebSocketData) => {
    switch (ipcData.cmd) {
        case "closetab":
            closeTab(ipcData);
            break;
        case "resetTabsStyle":
            document.querySelectorAll(".layout-tab-bars--drag").forEach(item => {
                item.classList.remove("layout-tab-bars--drag");
            });
            document.querySelectorAll(".layout-tab-bar li[data-clone='true']").forEach(tabItem => {
                tabItem.remove();
            });
            break;
        case "lockscreen":
            exportLayout({
                errorExit: false,
                cb() {
                    fetchPost("/api/system/logoutAuth", {}, () => {
                        redirectToCheckAuth();
                    });
                }
            });
            break;
        case "lockscreenByMode":
            if (window.siyuan.config.system.lockScreenMode === 1) {
                exportLayout({
                    errorExit: false,
                    cb() {
                        fetchPost("/api/system/logoutAuth", {}, () => {
                            redirectToCheckAuth();
                        });
                    }
                });
            }
            break;
    }
};
