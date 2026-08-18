import {fetchPost, fetchSyncPost} from "../util/fetch";
import {getDisplayName, getNotebookName, isEncryptedBox} from "../util/pathName";
import {confirmDialog} from "../dialog/confirmDialog";
import {hasTopClosestByTag} from "../protyle/util/hasClosest";
import {escapeHtml} from "../util/escape";
import {Constants} from "../constants";
import {checkBlockRef, getBlockRefWarningHTML} from "../util/checkBlockRef";
import {getDocTreeDeleteTargets} from "../menus/navigationSelection";

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

export const deleteNotebooks = async (notebookIds: string[]) => {
    const uniqueNotebookIds = Array.from(new Set(notebookIds));
    const refResults = await Promise.all(uniqueNotebookIds.map((notebook) => checkBlockRef({
        scope: "notebook",
        notebook,
    })));
    if (refResults.some((result) => result === undefined)) {
        return;
    }
    const notebookNames = uniqueNotebookIds.map((notebook) => escapeHtml(getNotebookName(notebook)))
        .join(", ");
    let tip = `${window.siyuan.languages.confirmDeleteTip.replace("${x}", notebookNames)}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
    if (refResults.some((result) => result)) {
        tip += getBlockRefWarningHTML();
    }
    confirmDialog(window.siyuan.languages.deleteOpConfirm, tip, async () => {
        for (const notebook of uniqueNotebookIds) {
            await fetchPost("/api/notebook/removeNotebook", {notebook});
        }
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
        const {notebookIds, paths} = getDocTreeDeleteTargets(liElements);
        if (notebookIds.length > 0 && paths.length === 0) {
            deleteNotebooks(notebookIds);
            return;
        }
        if (paths.length === 0) {
            return;
        }
        if (notebookIds.length > 0) {
            const refResults = await Promise.all([
                checkBlockRef({
                    scope: "documents",
                    paths,
                }),
                ...notebookIds.map((notebook) => checkBlockRef({
                    scope: "notebook",
                    notebook,
                })),
            ]);
            if (refResults.some((result) => result === undefined)) {
                return;
            }
            const itemNames = liElements.map((item) => {
                const name = item.querySelector(".b3-list-item__text")?.textContent?.trim();
                if (name) {
                    return escapeHtml(name);
                }
                if (item.getAttribute("data-type") === "navigation-root") {
                    const notebook = item.closest("ul[data-url]")?.getAttribute("data-url");
                    return notebook ? escapeHtml(getNotebookName(notebook)) : "";
                }
                return escapeHtml(getDisplayName(item.getAttribute("data-path"), true, true));
            }).filter(Boolean).join(", ");
            let tip = `${window.siyuan.languages.confirmDeleteTip.replace("${x}", itemNames)}
<div class="fn__hr"></div>
<div class="ft__smaller ft__on-surface">${window.siyuan.languages.rollbackTip.replace("${x}", window.siyuan.config.editor.historyRetentionDays)}</div>`;
            if (refResults.some((result) => result)) {
                tip += getBlockRefWarningHTML();
            }
            confirmDialog(window.siyuan.languages.deleteOpConfirm, tip, async () => {
                await fetchPost("/api/filetree/removeDocs", {paths});
                for (const notebook of notebookIds) {
                    await fetchPost("/api/notebook/removeNotebook", {notebook});
                }
            }, undefined, true);
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
