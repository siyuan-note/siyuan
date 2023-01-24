import {openMobileFileById} from "../editor";
import {progressLoading, progressStatus, transactionError} from "../../dialog/processSystem";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";

export const onMessage = (data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                if (document.querySelector("#menuSyncNow")) {
                    if (data.code === 0) {
                        document.querySelector("#menuSyncNow svg").classList.add("fn__rotate");
                    } else {
                        document.querySelector("#menuSyncNow svg").classList.remove("fn__rotate");

                    }
                }
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
