import {Protyle} from "../protyle";
import {setEditor} from "./util/setEmpty";
import {closePanel} from "./util/closePanel";
import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {onGet} from "../protyle/util/onGet";
import {addLoading} from "../protyle/ui/initUI";
import {highlightById, scrollCenter} from "../util/highlightById";
import {isInEmbedBlock} from "../protyle/util/hasClosest";
import {setEditMode} from "../protyle/util/setEditMode";
import {hideElements} from "../protyle/ui/hideElements";
import {setStorageVal} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import type {App} from "../index";
import {initMirror} from "../protyle/undo/globalUndo";
import {getDocByScroll, saveScroll} from "../protyle/scroll/saveScroll";
import {isEncryptedBox} from "../util/pathName";

export const getCurrentEditor = () => {
    return window.siyuan.mobile.popEditor || window.siyuan.mobile.editor;
};

// 串行更新时间，避免快速切换文档时较早的关闭请求覆盖较新的打开状态。
let recentDocSwitchPromise = Promise.resolve();
type TRecentDocUpdate = {
    type: "open" | "view";
    rootID: string;
} | {
    type: "switch";
    rootID: string;
    previousRootID: string;
};
let lastLoadedRecentDocRootID: string | undefined;
export const createRecentDocUpdate = (rootID: string, fallbackRootID?: string): TRecentDocUpdate => {
    const previousRootID = lastLoadedRecentDocRootID ?? fallbackRootID;
    lastLoadedRecentDocRootID = rootID;
    if (!previousRootID) {
        return {type: "open", rootID};
    }
    if (previousRootID === rootID) {
        return {type: "view", rootID};
    }
    return {type: "switch", rootID, previousRootID};
};
export const updateRecentDocSwitchTime = (update: TRecentDocUpdate) => {
    recentDocSwitchPromise = recentDocSwitchPromise.then(async () => {
        if (update.type === "view") {
            return fetchPost("/api/storage/updateRecentDocViewTime", {rootID: update.rootID});
        }
        if (update.type === "switch") {
            await fetchPost("/api/storage/updateRecentDocCloseTime", {rootID: update.previousRootID});
        }
        return fetchPost("/api/storage/updateRecentDocOpenTime", {rootID: update.rootID});
    });
};

export const loadMobileFileById = (app: App, id: string, action: TProtyleAction[] = [Constants.CB_GET_HL],
                                   scrollPosition?: ScrollLogicalPosition, notebookId?: string,
                                   afterOpen?: (protyle: IProtyle) => void, forceReload = false,
                                   isValid: () => boolean = () => true, signal?: AbortSignal,
                                   scrollAttr?: IScrollAttr, updateRecent = true,
                                   onFailure?: (invalid?: boolean) => void) => {
    let completed = false;
    const complete = (protyle: IProtyle) => {
        if (completed) {
            return;
        }
        completed = true;
        afterOpen?.(protyle);
    };
    const fail = (invalid = false) => {
        if (completed) {
            return;
        }
        completed = true;
        onFailure?.(invalid);
    };
    if (!isValid()) {
        fail();
        return;
    }
    const avPanelElement = document.querySelector(".av__panel");
    if (avPanelElement && !avPanelElement.classList.contains("fn__none")) {
        avPanelElement.dispatchEvent(new CustomEvent("click", {detail: "close"}));
    }
    if (window.siyuan.mobile.editor) {
        saveScroll(window.siyuan.mobile.editor.protyle);
        hideElements(["toolbar", "hint", "util"], window.siyuan.mobile.editor.protyle);
        if (window.siyuan.mobile.editor.protyle.contentElement.classList.contains("fn__none")) {
            setEditMode(window.siyuan.mobile.editor.protyle, "wysiwyg");
        }
        let blockElement: HTMLElement | undefined;
        Array.from(window.siyuan.mobile.editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find((item: HTMLElement) => {
            if (!isInEmbedBlock(item)) {
                blockElement = item;
                return true;
            }
        });
        const protyle = window.siyuan.mobile.editor.protyle;
        const shouldReload = forceReload ||
            (action.includes(Constants.CB_GET_ALL) && (!protyle.block.showAll || protyle.block.id !== id)) ||
            blockElement?.clientHeight === 0;
        if (blockElement && !shouldReload) {
            if (action.includes(Constants.CB_GET_HL)) {
                highlightById(protyle, id, scrollPosition);
            } else {
                scrollCenter(protyle, blockElement, scrollPosition);
            }
            if (!protyle.block.showAll) {
                protyle.block.id = protyle.block.rootID;
                protyle.wysiwyg.element.setAttribute("data-doc-type", "NodeDocument");
            }
            closePanel();
            // 更新文档浏览时间
            const rootID = protyle.block.rootID;
            if (updateRecent) {
                updateRecentDocSwitchTime(createRecentDocUpdate(rootID, rootID));
            }
            complete(protyle);
            return;
        }
    }

    const targetNotebookId = notebookId || window.siyuan.mobile.editor?.protyle?.notebookId;
    const blockInfoParam: IObject = {id};
    if (isEncryptedBox(targetNotebookId)) {
        blockInfoParam.notebook = targetNotebookId;
    }
    let blockInfoHandled = false;
    void fetchPost("/api/block/getBlockInfo", blockInfoParam, (data) => {
        blockInfoHandled = true;
        if (!isValid()) {
            fail();
            return;
        }
        if (data.code === 3) {
            showMessage(data.msg);
            fail(true);
            return;
        }
        if (data.code !== 0 || !data.data?.rootID) {
            fail();
            return;
        }
        const isRootFocus = id === data.data.rootID &&
            action.includes(Constants.CB_GET_ALL) &&
            action.includes(Constants.CB_GET_FOCUS);
        const actionList = isRootFocus ? action.filter((item) => item !== Constants.CB_GET_ALL) : [...action];
        if (!actionList.includes(Constants.CB_GET_ALL) && !actionList.includes(Constants.CB_GET_SETID)) {
            actionList.push(Constants.CB_GET_SETID);
        }
        const previousRootID = window.siyuan.mobile.editor?.protyle.block.rootID;
        const protyleOptions: IProtyleOptions = {
            databaseAttr: true,
            blockId: id,
            rootId: data.data.rootID,
            notebookId: data.data.box,
            scrollPosition,
            action: actionList,
            render: {
                scroll: true,
                title: true,
                titleShowTop: true,
                background: true,
                gutter: true,
            },
            typewriterMode: true,
            preview: {
                actions: ["mp-wechat", "zhihu", "yuque"]
            },
            after: (editor) => {
                if (!isValid()) {
                    fail();
                    return;
                }
                if (updateRecent) {
                    updateRecentDocSwitchTime(createRecentDocUpdate(data.data.rootID, previousRootID));
                }
                complete(editor.protyle);
            },
        };
        if (window.siyuan.mobile.editor) {
            window.siyuan.mobile.editor.protyle.notebookId = data.data.box;
            window.siyuan.mobile.editor.protyle.title.element.removeAttribute("data-render");
            addLoading(window.siyuan.mobile.editor.protyle);
            if (previousRootID !== data.data.rootID) {
                window.siyuan.mobile.editor.protyle.wysiwyg.element.innerHTML = "";
            }
            const targetScrollAttr = scrollAttr || window.siyuan.storage[Constants.LOCAL_FILEPOSITION][data.data.rootID];
            if (actionList.includes(Constants.CB_GET_SCROLL) && targetScrollAttr) {
                getDocByScroll({
                    protyle: window.siyuan.mobile.editor.protyle,
                    scrollAttr: targetScrollAttr,
                    mergedOptions: protyleOptions,
                    signal,
                    fail,
                    isValid,
                    cb() {
                        if (!isValid()) {
                            fail();
                            return;
                        }
                        if (updateRecent) {
                            updateRecentDocSwitchTime(createRecentDocUpdate(data.data.rootID, previousRootID));
                        }
                        app.plugins.forEach(item => {
                            item.eventBus.emit("switch-protyle", {protyle: window.siyuan.mobile.editor.protyle});
                        });
                        complete(window.siyuan.mobile.editor.protyle);
                    }
                });
            } else {
                const getDocParam: IObject = {
                    id,
                    size: actionList.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
                    mode: actionList.includes(Constants.CB_GET_CONTEXT) ? 3 : 0,
                };
                if (isEncryptedBox(window.siyuan.mobile.editor.protyle.notebookId)) {
                    getDocParam.notebook = window.siyuan.mobile.editor.protyle.notebookId;
                }
                let getDocHandled = false;
                void fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
                    getDocHandled = true;
                    if (!isValid()) {
                        fail();
                        return;
                    }
                    if (getResponse.code !== 0 && onFailure) {
                        fail(true);
                        return;
                    }
                    try {
                        onGet({
                            data: getResponse,
                            protyle: window.siyuan.mobile.editor.protyle,
                            action: actionList,
                            scrollPosition,
                            isValid,
                            afterCB() {
                                if (!isValid()) {
                                    fail();
                                    return;
                                }
                                if (updateRecent) {
                                    updateRecentDocSwitchTime(createRecentDocUpdate(data.data.rootID, previousRootID));
                                }
                                app.plugins.forEach(item => {
                                    item.eventBus.emit("switch-protyle", {protyle: window.siyuan.mobile.editor.protyle});
                                });
                                complete(window.siyuan.mobile.editor.protyle);
                            }
                        });
                    } catch (error) {
                        console.error(error);
                        fail();
                    }
                }, undefined, undefined, signal).then(() => {
                    if (!getDocHandled) {
                        fail();
                    }
                });
            }
            window.siyuan.mobile.editor.protyle.undo.clear();
            // 切换文档后校准新文档的撤销镜像（语义 B：各文档栈隔离）
            if (window.siyuan.mobile.editor.protyle.block?.rootID) {
                initMirror(window.siyuan.mobile.editor.protyle.block.rootID);
            }
        } else {
            try {
                window.siyuan.mobile.editor = new Protyle(app, document.getElementById("editor"), protyleOptions);
            } catch (error) {
                console.error(error);
                fail();
                return;
            }
        }
        setEditor();
        closePanel();
    }, undefined, undefined, signal).then(() => {
        if (!blockInfoHandled) {
            fail();
        }
    });
};

export const openMobileFileById = (app: App, id: string, action: TProtyleAction[] = [Constants.CB_GET_HL],
                                   scrollPosition?: ScrollLogicalPosition, notebookId?: string,
                                   afterOpen?: (protyle: IProtyle) => void, forceReload = false) => {
    if (window.siyuan.mobile.tabs) {
        const options = {action, scrollPosition, notebookId, afterOpen, forceReload};
        if (action.includes(Constants.CB_GET_OPENNEW)) {
            void window.siyuan.mobile.tabs.openInNewTab(id, options).then((result) => {
                if (result === "invalid" || result === "failed") {
                    void window.siyuan.mobile.tabs.restore();
                }
            });
        } else {
            void window.siyuan.mobile.tabs.open(id, options).then((result) => {
                if (result === "invalid" || result === "failed") {
                    void window.siyuan.mobile.tabs.restore();
                }
            });
        }
        return;
    }
    window.siyuan.storage[Constants.LOCAL_DOCINFO] = isEncryptedBox(notebookId) ? {id: ""} : {id};
    setStorageVal(Constants.LOCAL_DOCINFO, window.siyuan.storage[Constants.LOCAL_DOCINFO]);
    loadMobileFileById(app, id, action, scrollPosition, notebookId, afterOpen, forceReload);
};

export const openMobileFileByIdInNewTab = (app: App, id: string,
                                           action: TProtyleAction[] = [Constants.CB_GET_HL],
                                           scrollPosition?: ScrollLogicalPosition, notebookId?: string,
                                           afterOpen?: (protyle: IProtyle) => void) => {
    if (window.siyuan.mobile.tabs) {
        void window.siyuan.mobile.tabs.openInNewTab(id, {
            action,
            scrollPosition,
            notebookId,
            afterOpen
        }).then((result) => {
            if (result === "invalid" || result === "failed") {
                void window.siyuan.mobile.tabs.restore();
            }
        });
    } else {
        openMobileFileById(app, id, action, scrollPosition, notebookId, afterOpen);
    }
};
