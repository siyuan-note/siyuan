import {openMobileFileById} from "../editor";
import {processSync, progressLoading, progressStatus, transactionError} from "../../dialog/processSystem";

export const onMessage = (data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                processSync(data);
                if (data.code !== 0) {
                    document.getElementById("transactionTip").classList.add("fn__none")
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
                transactionError(data);
                break;
            case"statusbar":
                progressStatus(data);
                break;
        }
    }
};
