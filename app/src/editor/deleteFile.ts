import {fetchPost, fetchSyncPost} from "../util/fetch";
import {getDisplayName, getNotebookName, isEncryptedBox} from "../util/pathName";
import {confirmDialog} from "../dialog/confirmDialog";
import {hasTopClosestByTag} from "../protyle/util/hasClosest";
import {showMessage} from "../dialog/message";
import {escapeHtml} from "../util/escape";
import {Constants} from "../constants";
import {checkBlockRef, getBlockRefWarningHTML} from "../util/checkBlockRef";

export const deleteFile = async (notebookId: string, pathString: string) => {
    const hasRef = await checkBlockRef({
        scope: "documents",
        paths: [pathString],
    });
    if (hasRef === undefined) {
        return;
    }
    if (window.siyuan.config.fileTree.removeDocWithoutConfirm && !hasRef) {
        fetchPost("/api/filetree/removeDoc", {
            notebook: notebookId,
            path: pathString
        });
        return;
    }
    const docInfoParam: IObject = {
        id: getDisplayName(pathString, true, true)
    };
    if (isEncryptedBox(notebookId)) {
        docInfoParam.notebook = notebookId;
    }
    const response = await fetchSyncPost("/api/block/getDocInfo", docInfoParam);
    if (response.code !== 0) {
        return;
    }
    const fileName = escapeHtml(response.data.name);
    let tip = `${window.siyuan.languages.confirmDeleteTip.replace("${x}", fileName)}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
    if (response.data.subFileCount > 0) {
        tip = `${window.siyuan.languages.andSubFile.replace("${x}", fileName).replace("${y}", response.data.subFileCount)}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
    }
    if (hasRef) {
        tip += getBlockRefWarningHTML();
    }
    confirmDialog(window.siyuan.languages.deleteOpConfirm, tip, () => {
        fetchPost("/api/filetree/removeDoc", {
            notebook: notebookId,
            path: pathString
        });
    }, undefined, true);
};

export const deleteFiles = async (liElements: Element[]) => {
    if (liElements.length === 1) {
        const itemTopULElement = hasTopClosestByTag(liElements[0], "UL");
        if (itemTopULElement) {
            const itemNotebookId = itemTopULElement.getAttribute("data-url");
            if (liElements[0].getAttribute("data-type") === "navigation-file") {
                deleteFile(itemNotebookId, liElements[0].getAttribute("data-path"));
            } else {
                const isHelpNotebook = Object.values(Constants.HELP_PATH).includes(itemNotebookId);
                if (isHelpNotebook) {
                    fetchPost("/api/notebook/removeNotebook", {
                        notebook: itemNotebookId,
                    });
                    return;
                }
                const hasRef = await checkBlockRef({
                    scope: "notebook",
                    notebook: itemNotebookId,
                });
                if (hasRef === undefined) {
                    return;
                }
                let tip = `${window.siyuan.languages.confirmDeleteTip.replace("${x}", Lute.EscapeHTMLStr(getNotebookName(itemNotebookId)))}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
                if (hasRef) {
                    tip += getBlockRefWarningHTML();
                }
                confirmDialog(window.siyuan.languages.deleteOpConfirm,
                    tip, () => {
                        fetchPost("/api/notebook/removeNotebook", {
                            notebook: itemNotebookId,
                        });
                    }, undefined, true);
            }
        }
    } else {
        const paths: string[] = [];
        liElements.forEach(item => {
            const dataPath = item.getAttribute("data-path");
            if (dataPath !== "/") {
                paths.push(item.getAttribute("data-path"));
            }
        });
        if (paths.length === 0) {
            showMessage(window.siyuan.languages.notBatchRemove);
            return;
        }
        const hasRef = await checkBlockRef({
            scope: "documents",
            paths,
        });
        if (hasRef === undefined) {
            return;
        }
        let tip = `${window.siyuan.languages.confirmRemoveAll.replace("${count}", paths.length)}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
        if (hasRef) {
            tip += getBlockRefWarningHTML();
        }
        confirmDialog(window.siyuan.languages.deleteOpConfirm,
            tip, () => {
                fetchPost("/api/filetree/removeDocs", {
                    paths
                });
            }, undefined, true);
    }
};
