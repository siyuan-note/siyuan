import {openMobileFileById} from "../editor";
import {progressLoading, progressStatus, transactionError} from "../../dialog/processSystem";

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
                break;
            case "create":
            case "createdailynote":
                openMobileFileById(data.data.id);
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
