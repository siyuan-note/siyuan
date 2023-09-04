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
        case "lockscreen":
            exportLayout({
                reload: false,
                onlyData: false,
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
                    reload: false,
                    onlyData: false,
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
