import {Dialog} from "../../dialog";
import {isMobile, objEquals} from "../../util/functions";
import {fetchPost} from "../../util/fetch";

export const setStatusBar = (element: HTMLElement) => {
    element.addEventListener("click", () => {
        const dialog = new Dialog({
            height: "80vh",
            width: isMobile() ? "92vw" : "360px",
            title: "\uD83D\uDD07 " + window.siyuan.languages.appearance18,
            content: `<div class="fn__hr"></div>
<div class="b3-label">
    ${window.siyuan.languages.statusBarMsgPushTip}
    <div class="fn__hr"></div>
    <div class="b3-tab-bar b3-list b3-list--background">
        <label class="b3-list-item">
            <div class="fn__flex-1 ft__on-surface">
               ${window.siyuan.languages["_taskAction"]["task.database.index.commit"]}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="msgTaskDatabaseIndexCommitDisabled" type="checkbox"${window.siyuan.config.appearance.statusBar.msgTaskDatabaseIndexCommitDisabled ? "" : " checked"}>
        </label>    
        <label class="b3-list-item">
            <div class="fn__flex-1 ft__on-surface">
               ${window.siyuan.languages["_taskAction"]["task.asset.database.index.commit"]}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="msgTaskAssetDatabaseIndexCommitDisabled" type="checkbox"${window.siyuan.config.appearance.statusBar.msgTaskAssetDatabaseIndexCommitDisabled ? "" : " checked"}>
        </label>
        <label class="b3-list-item">
            <div class="fn__flex-1 ft__on-surface">
               ${window.siyuan.languages["_taskAction"]["task.history.database.index.commit"]}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="msgTaskHistoryDatabaseIndexCommitDisabled" type="checkbox"${window.siyuan.config.appearance.statusBar.msgTaskHistoryDatabaseIndexCommitDisabled ? "" : " checked"}>
        </label>
        <label class="b3-list-item">
            <div class="fn__flex-1 ft__on-surface">
               ${window.siyuan.languages["_taskAction"]["task.history.generateFile"]}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="msgTaskHistoryGenerateFileDisabled" type="checkbox"${window.siyuan.config.appearance.statusBar.msgTaskHistoryGenerateFileDisabled ? "" : " checked"}>
        </label>
    </div>
</div>`, destroyCallback() {
                const statusBar = {
                    msgTaskDatabaseIndexCommitDisabled: !(dialog.element.querySelector("#msgTaskDatabaseIndexCommitDisabled") as HTMLInputElement).checked,
                    msgTaskAssetDatabaseIndexCommitDisabled: !(dialog.element.querySelector("#msgTaskAssetDatabaseIndexCommitDisabled") as HTMLInputElement).checked,
                    msgTaskHistoryDatabaseIndexCommitDisabled: !(dialog.element.querySelector("#msgTaskHistoryDatabaseIndexCommitDisabled") as HTMLInputElement).checked,
                    msgTaskHistoryGenerateFileDisabled: !(dialog.element.querySelector("#msgTaskHistoryGenerateFileDisabled") as HTMLInputElement).checked,
                };
                if (objEquals(statusBar, window.siyuan.config.appearance.statusBar)) {
                    return;
                }
                fetchPost("/api/setting/setAppearance", Object.assign({}, window.siyuan.config.appearance, {
                    statusBar
                }));
            }
        });
    });
};
