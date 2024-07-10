import {openMobileFileById} from "../editor";
import {processSync, progressLoading, progressStatus, reloadSync, transactionError} from "../../dialog/processSystem";
import {Constants} from "../../constants";
import {App} from "../../index";
import {reloadPlugin} from "../../plugin/loader";
import {fetchPost} from "../../util/fetch";

export const onMessage = (app: App, data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "reloadPlugin":
                reloadPlugin(app, data.data);
                break;
            case "reloadEmojiConf":
                fetchPost("/api/system/getEmojiConf", {}, response => {
                    window.siyuan.emojis = response.data as IEmoji[];
                });
                break;
            case "syncMergeResult":
                reloadSync(app, data.data);
                break;
            case "setConf":
                window.siyuan.config = data.data;
                break;
            case "readonly":
                window.siyuan.config.editor.readOnly = data.data;
                break;
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                processSync(data, app.plugins);
                if (data.code === 1) {
                    document.getElementById("toolbarSync").classList.add("fn__none");
                }
                break;
            case "openFileById":
                openMobileFileById(app, data.data.id, [Constants.CB_GET_HL]);
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
