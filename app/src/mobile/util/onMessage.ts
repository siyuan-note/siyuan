import {openMobileFileById} from "../editor";
import {
    processSync,
    progressLoading,
    reloadSync,
    setDefRefCount,
    setRefDynamicText,
    transactionError
} from "../../dialog/processSystem";
import {App} from "../../index";
import {reloadPlugin} from "../../plugin/loader";
import {reloadEmoji} from "../../emoji";
import {setLocalShorthandCount} from "../../util/noRelyPCFunction";
import {updateControlAlt} from "../../protyle/util/hotKey";
import {renderSnippet} from "../../config/util/snippets";
import {redirectToCheckAuth} from "../../util/pathName";

let statusTimeout: number;
const statusElement = document.querySelector("#status") as HTMLElement;

export const onMessage = (app: App, data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "logoutAuth":
                redirectToCheckAuth();
                break;
            case "backgroundtask":
                if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none") ||
                    window.siyuan.config.appearance.hideStatusBar) {
                    return;
                }
                if (data.data.tasks.length === 0) {
                    statusElement.style.bottom = "";
                } else {
                    clearTimeout(statusTimeout);
                    statusElement.innerHTML = `<div class="fn__flex">${data.data.tasks[0].action}<div class="fn__progress"><div></div></div>`;
                    statusElement.style.bottom = "0";
                }
                break;
            case "setAppearance":
                window.location.reload();
                break;
            case "setSnippet":
                window.siyuan.config.snippet = data.data;
                renderSnippet();
                break;
            case "setDefRefCount":
                setDefRefCount(data.data);
                break;
            case "reloadTag":
                window.siyuan.mobile.docks.tag?.update();
                break;
            case "setLocalShorthandCount":
                setLocalShorthandCount();
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
                updateControlAlt();
                break;
            case "setPublish":
                window.siyuan.config.publish = data.data;
                setPublish();
                break;
            case "reloaddoc":
                reloadSync(this, {upsertRootIDs: [data.data], removeRootIDs: []}, false, false, true);
                break;
            case "readonly":
                window.siyuan.config.editor.readOnly = data.data;
                break;
            case "setLocalStorageVal":
                window.siyuan.storage[data.data.key] = data.data.val;
                break;
            case "setLocalStorageVals":
                Object.keys(data.data.keyVals).forEach((k) => {
                    window.siyuan.storage[k] = data.data.keyVals[k];
                });
                break;
            case "removeLocalStorageVal":
                delete window.siyuan.storage[data.data.key];
                break;
            case "removeLocalStorageVals":
                data.data.keys.forEach((k: string) => {
                    delete window.siyuan.storage[k];
                });
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
                if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none") ||
                    window.siyuan.config.appearance.hideStatusBar) {
                    return;
                }
                clearTimeout(statusTimeout);
                statusElement.innerHTML = data.msg;
                statusElement.style.bottom = "0";
                statusTimeout = window.setTimeout(() => {
                    statusElement.style.bottom = "";
                }, 12000);
                break;
        }
    }
};

const setPublish = () => {
    const accessElement = window.siyuan.mobile.docks.file.element.previousElementSibling.querySelector('[data-type="publish-access"]');
    if (!window.siyuan.config.publish.enable) {
        accessElement.classList.remove("block__icon--active");
        accessElement.classList.add("fn__none");
        window.siyuan.mobile.docks.file.element.querySelectorAll(".b3-list-item__icon").forEach(item => {
            item.classList.remove("fn__none");
            item.nextElementSibling.classList.add("fn__none");
        });
    } else {
        accessElement.classList.remove("fn__none");
    }

};
