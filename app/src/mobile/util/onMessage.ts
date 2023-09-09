import {openMobileFileById} from "../editor";
import {processSync, progressLoading, progressStatus, reloadSync, transactionError} from "../../dialog/processSystem";
import {Constants} from "../../constants";
import {App} from "../../index";

export const onMessage = (app: App, data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "syncMergeResult":
                reloadSync(app, data.data);
                break;
            case "readonly":
                window.siyuan.config.editor.readOnly = data.data;
                break;
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                processSync(data);
                if (data.code === 1) {
                    document.getElementById("toolbarSync").classList.add("fn__none");
                }
                break;
            case "createdailynote":
                openMobileFileById(app, data.data.id);
                break;
            case "openFileById":
                openMobileFileById(app, data.data.id, [Constants.CB_GET_FOCUS]);
                break;
            case"txerr":
                transactionError();
                break;
            case"statusbar":
                progressStatus(data);
                break;
        }
    }
};
