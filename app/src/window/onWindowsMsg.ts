import {exportLayout, getInstanceById} from "../layout/util";
import {Tab} from "../layout/Tab";
import {fetchPost} from "../util/fetch";
import {redirectToCheckAuth} from "../util/functions";

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
            exportLayout(false, () => {
                fetchPost("/api/system/logoutAuth", {}, () => {
                    redirectToCheckAuth();
                });
            }, false, false);
            break;
    }
};
