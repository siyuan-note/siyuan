import {openMobileFileById} from "../editor";
import {processSync, progressLoading, progressStatus, reloadSync, transactionError} from "../../dialog/processSystem";
import {Constants} from "../../constants";

const processReadonly = () => {
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    const editIconElement = document.querySelector("#toolbarEdit use");
    if (!window.siyuan.config.editor.readOnly) {
        inputElement.readOnly = false;
        editIconElement.setAttribute("xlink:href", "#iconEdit");
    } else {
        inputElement.readOnly = true;
        editIconElement.setAttribute("xlink:href", "#iconPreview");
    }
};

export const onMessage = (data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "syncMergeResult":
                reloadSync(data.data);
                break;
            case "readonly":
                window.siyuan.config.editor.readOnly = data.data;
                processReadonly();
                break;
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                processSync(data);
                if (data.code !== 0) {
                    document.getElementById("toolbarSync").classList.add("fn__none");
                }
                break;
            case "create":
            case "createdailynote":
                openMobileFileById(data.data.id);
                break;
            case "openFileById":
                openMobileFileById(data.data.id, [Constants.CB_GET_FOCUS]);
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
