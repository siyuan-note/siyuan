import {openMobileFileById} from "../editor";
import {
    processSync,
    progressLoading,
    progressStatus,
    reloadSync, setDefRefCount, setRefDynamicText,
    transactionError
} from "../../dialog/processSystem";
import {App} from "../../index";
import {reloadPlugin} from "../../plugin/loader";
import {reloadEmoji} from "../../emoji";

export const onMessage = (app: App, data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "setDefRefCount":
                setDefRefCount(data.data);
                break;
            case "setRefDynamicText":
                setRefDynamicText(data.data);
                break;
            case "reloadPlugin":
                reloadPlugin(app, data.data);
                break;
            case "reloadEmojiConf":
                reloadEmoji();
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
                openMobileFileById(app, data.data.id);
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
