import type {BlockQueryRequestInput} from "../types/api";
import type {App} from "../index";
import {hideMessage} from "../dialog/message";
import {hideElements} from "../protyle/ui/hideElements";
import {setEmpty} from "../mobile/util/setEmpty";
import {fetchPost} from "./fetch";
import {Constants} from "../constants";
import {getDocDisplayName, isEncryptedBox, setNoteBook} from "./pathName";
import {getAllModels} from "../layout/getAll";
import {setStorageVal} from "../protyle/util/compatibility";
import type {Tab} from "../layout/Tab";
import {setTitle} from "./processTitle";
import {reloadProtyleAndWait} from "../protyle/util/reload";

const pendingSyncReloads = new Set<Promise<void>>();
const trackSyncReload = (task: Promise<void>) => {
    pendingSyncReloads.add(task);
    void task.catch(error => console.error(error)).finally(() => pendingSyncReloads.delete(task));
};

export const waitForSyncReloads = async () => {
    while (pendingSyncReloads.size) {
        await Promise.all([...pendingSyncReloads]);
    }
};
/// #if MOBILE
import {getMobileBacklinkPanels, removeMobileBacklinkContent} from "../mobile/util/backlinkPanels";
import {refreshMobileReferenceSheet, removeMobileReferenceSheet} from "../mobile/util/openReference";
/// #endif
/// #if !MOBILE
import {removeBlockPanelEditors} from "../block/panelRemoval";
/// #endif

export const reloadSync = (
    app: App,
    data: { upsertRootIDs: string[], removeRootIDs: string[] },
    hideMsg = true,
    // 同步的时候需要更新只读状态 https://github.com/siyuan-note/siyuan/issues/11517
    // 调整大纲的时候需要使用现有状态 https://github.com/siyuan-note/siyuan/issues/11808
    updateReadonly = true,
    onlyUpdateDoc = false
) => {
    if (hideMsg) {
        hideMessage();
    }
    /// #if MOBILE
    removeMobileBacklinkContent({rootIDs: data.removeRootIDs});
    removeMobileReferenceSheet({rootIDs: data.removeRootIDs});
    refreshMobileReferenceSheet(data.upsertRootIDs, updateReadonly);
    getMobileBacklinkPanels().forEach(panel => {
        panel.markIndexDirty({backlinkChanged: true, backlinkFull: true});
        panel.refreshAfterIndex();
    });
    if (window.siyuan.mobile.popEditor && window.siyuan.mobile.popEditor.protyle) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.popEditor.protyle.block.rootID)) {
            hideElements(["dialog"]);
        } else {
            trackSyncReload(reloadProtyleAndWait(window.siyuan.mobile.popEditor.protyle, updateReadonly));
        }
    }
    window.siyuan.mobile.tabs?.removeRoots(data.removeRootIDs);
    if (document.getElementById("empty").classList.contains("fn__none") &&
        window.siyuan.mobile.editor && window.siyuan.mobile.editor.protyle) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.editor.protyle.block.rootID)) {
            if (!window.siyuan.mobile.tabs) {
                setEmpty(app);
            }
        } else {
            const editor = window.siyuan.mobile.editor;
            const protyle = editor.protyle;
            const rootID = protyle.block.rootID;
            const notebookID = protyle.notebookId;
            const docInfoParam: BlockQueryRequestInput = {
                id: rootID
            };
            if (isEncryptedBox(notebookID)) {
                docInfoParam.notebook = notebookID;
            }
            const title = new Promise<void>((resolve, reject) => {
                void fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                    if (response.code !== 0 || !response.data) {
                        reject(new Error("Could not refresh synchronized document title"));
                        return;
                    }
                    if (window.siyuan.mobile.editor === editor && editor.protyle === protyle &&
                        protyle.block.rootID === rootID && protyle.notebookId === notebookID) {
                        setTitle(response.data.name);
                        protyle.title?.setTitle(response.data.name, response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true");
                    }
                    resolve();
                }, undefined, () => reject(new Error("Could not refresh synchronized document title"))).catch(reject);
            });
            trackSyncReload(Promise.all([reloadProtyleAndWait(protyle, updateReadonly), title]).then(() => {}));
            // 同步刷新移动端大纲，避免大纲与重载后的编辑器数据不一致
            const outline = window.siyuan.mobile.docks.outline;
            if (outline) {
                outline.reload();
            }
        }
    }
    setNoteBook(() => {
        window.siyuan.mobile.docks.file?.init(false);
    });
    /// #else
    removeBlockPanelEditors({rootIDs: data.removeRootIDs});
    const allModels = getAllModels();
    const updateTitle = (rootID: string, tab: Tab, protyle?: IProtyle) => {
        const docInfoParam: BlockQueryRequestInput = {
            id: rootID
        };
        if (protyle && isEncryptedBox(protyle.notebookId)) {
            docInfoParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
            const titleEmpty = response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true";
            tab.updateTitle(getDocDisplayName(response.data.name, titleEmpty));
            if (protyle && protyle.title) {
                protyle.title.setTitle(response.data.name, titleEmpty);
            }
        });
    };
    allModels.editor.forEach(item => {
        if (data.upsertRootIDs.includes(item.editor.protyle.block.rootID)) {
            const docInfoParam: BlockQueryRequestInput = {
                id: item.editor.protyle.block.rootID,
            };
            if (isEncryptedBox(item.editor.protyle.notebookId)) {
                docInfoParam.notebook = item.editor.protyle.notebookId;
            }
            trackSyncReload(new Promise<void>((resolve, reject) => {
                void fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                    if (response.code !== 0 || !response.data) {
                        reject(new Error("Could not refresh synchronized document"));
                        return;
                    }
                    item.editor.protyle.wysiwyg.renderCustom(response.data.ial);
                    const titleEmpty = response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true";
                    item.parent.updateTitle(getDocDisplayName(response.data.name, titleEmpty));
                    item.editor.protyle.title?.setTitle(response.data.name, titleEmpty);
                    void reloadProtyleAndWait(item.editor.protyle, updateReadonly).then(resolve, reject);
                }, undefined, () => reject(new Error("Could not refresh synchronized document"))).catch(reject);
            }));
        } else if (data.removeRootIDs.includes(item.editor.protyle.block.rootID)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
            delete window.siyuan.storage[Constants.LOCAL_FILEPOSITION][item.editor.protyle.block.rootID];
            setStorageVal(Constants.LOCAL_FILEPOSITION, window.siyuan.storage[Constants.LOCAL_FILEPOSITION]);
        }
    });
    allModels.graph.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.rootId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else if (item.type !== "local" || data.upsertRootIDs.includes(item.rootId)) {
            item.searchGraph();
            if (item.type === "local") {
                updateTitle(item.rootId, item.parent);
            }
        }
    });
    allModels.outline.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.blockId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else if (item.blockId && (item.type !== "local" || data.upsertRootIDs.includes(item.blockId))) {
            const outlineParam: IObject = {
                id: item.blockId,
                preview: item.isPreview
            };
            // 解析大纲面板所属 box：按 blockId 在已打开的编辑器里查找
            let notebookId: string;
            allModels.editor.some(editorItem => {
                if (editorItem.editor.protyle.block.rootID === item.blockId) {
                    notebookId = editorItem.editor.protyle.notebookId;
                    return true;
                }
            });
            if (isEncryptedBox(notebookId)) {
                outlineParam.notebook = notebookId;
            }
            fetchPost("/api/outline/getDocOutline", outlineParam, response => {
                item.update(response);
            });
            if (item.type === "local") {
                updateTitle(item.blockId, item.parent);
            }
        }
    });
    allModels.backlink.forEach(item => {
        if (item.type === "bottom") {
            item.markDirty();
            item.refreshIfVisible();
            return;
        }
        if (item.type === "local" && data.removeRootIDs.includes(item.rootId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else {
            item.refresh();
            if (item.type === "local") {
                updateTitle(item.rootId, item.parent);
            }
        }
    });
    if (!onlyUpdateDoc) {
        allModels.files.forEach(item => {
            setNoteBook(() => {
                item.init(false);
            });
        });
    }
    allModels.bookmark.forEach(item => {
        item.update();
    });
    allModels.tag.forEach(item => {
        item.update();
    });
    // NOTE asset 无法获取推送地址，先不处理
    allModels.search.forEach(item => {
        item.parent.panelElement.querySelector("#searchInput").dispatchEvent(new CustomEvent("input"));
    });
    allModels.custom.forEach(item => {
        if (item.update) {
            item.update();
        }
    });
    /// #endif
};
