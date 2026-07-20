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
import {pushBack} from "./util/MobileBackFoward";
import {setStorageVal} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {App} from "../index";
import {initMirror} from "../protyle/undo/globalUndo";
import {getDocByScroll, saveScroll} from "../protyle/scroll/saveScroll";
import {isEncryptedBox} from "../util/pathName";

export const getCurrentEditor = () => {
    return window.siyuan.mobile.popEditor || window.siyuan.mobile.editor;
};

export const openMobileFileById = (app: App, id: string, action: TProtyleAction[] = [Constants.CB_GET_HL],
                                   scrollPosition?: ScrollLogicalPosition, notebookId?: string,
                                   afterOpen?: (protyle: IProtyle) => void, forceReload = false) => {
    window.siyuan.storage[Constants.LOCAL_DOCINFO] = {id};
    setStorageVal(Constants.LOCAL_DOCINFO, window.siyuan.storage[Constants.LOCAL_DOCINFO]);
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
        let blockElement;
        Array.from(window.siyuan.mobile.editor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find((item: HTMLElement) => {
            if (!isInEmbedBlock(item)) {
                blockElement = item;
                return true;
            }
        });
        if (blockElement && !forceReload) {
            pushBack();
            if (action.includes(Constants.CB_GET_HL)) {
                highlightById(window.siyuan.mobile.editor.protyle, id, scrollPosition);
            } else {
                scrollCenter(window.siyuan.mobile.editor.protyle, blockElement, scrollPosition);
            }
            closePanel();
            // 更新文档浏览时间
            fetchPost("/api/storage/updateRecentDocViewTime", {rootID: window.siyuan.mobile.editor.protyle.block.rootID});
            afterOpen?.(window.siyuan.mobile.editor.protyle);
            return;
        }
    }

    const targetNotebookId = notebookId || window.siyuan.mobile.editor?.protyle?.notebookId;
    const blockInfoParam: IObject = {id};
    if (isEncryptedBox(targetNotebookId)) {
        blockInfoParam.notebook = targetNotebookId;
    }
    fetchPost("/api/block/getBlockInfo", blockInfoParam, (data) => {
        if (data.code === 3) {
            showMessage(data.msg);
            return;
        }
        const protyleOptions: IProtyleOptions = {
            databaseAttr: true,
            blockId: id,
            rootId: data.data.rootID,
            notebookId: data.data.box,
            scrollPosition,
            action,
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
            after: (editor) => afterOpen?.(editor.protyle),
        };
        if (window.siyuan.mobile.editor) {
            window.siyuan.mobile.editor.protyle.notebookId = data.data.box;
            window.siyuan.mobile.editor.protyle.title.element.removeAttribute("data-render");
            pushBack();
            addLoading(window.siyuan.mobile.editor.protyle);
            if (window.siyuan.mobile.editor.protyle.block.rootID !== data.data.rootID) {
                window.siyuan.mobile.editor.protyle.wysiwyg.element.innerHTML = "";
                fetchPost("/api/storage/updateRecentDocOpenTime", {rootID: data.data.rootID});
            } else {
                fetchPost("/api/storage/updateRecentDocViewTime", {rootID: data.data.rootID});
            }
            if (action.includes(Constants.CB_GET_SCROLL) && window.siyuan.storage[Constants.LOCAL_FILEPOSITION][data.data.rootID]) {
                getDocByScroll({
                    protyle: window.siyuan.mobile.editor.protyle,
                    scrollAttr: window.siyuan.storage[Constants.LOCAL_FILEPOSITION][data.data.rootID],
                    mergedOptions: protyleOptions,
                    cb() {
                        app.plugins.forEach(item => {
                            item.eventBus.emit("switch-protyle", {protyle: window.siyuan.mobile.editor.protyle});
                        });
                        afterOpen?.(window.siyuan.mobile.editor.protyle);
                    }
                });
            } else {
                const getDocParam: IObject = {
                    id,
                    size: action.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
                    mode: action.includes(Constants.CB_GET_CONTEXT) ? 3 : 0,
                };
                if (isEncryptedBox(window.siyuan.mobile.editor.protyle.notebookId)) {
                    getDocParam.notebook = window.siyuan.mobile.editor.protyle.notebookId;
                }
                fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
                    onGet({
                        data: getResponse,
                        protyle: window.siyuan.mobile.editor.protyle,
                        action,
                        scrollPosition,
                        afterCB() {
                            app.plugins.forEach(item => {
                                item.eventBus.emit("switch-protyle", {protyle: window.siyuan.mobile.editor.protyle});
                            });
                            afterOpen?.(window.siyuan.mobile.editor.protyle);
                        }
                    });
                });
            }
            window.siyuan.mobile.editor.protyle.undo.clear();
            // 切换文档后校准新文档的撤销镜像（语义 B：各文档栈隔离）
            if (window.siyuan.mobile.editor.protyle.block?.rootID) {
                initMirror(window.siyuan.mobile.editor.protyle.block.rootID);
            }
        } else {
            fetchPost("/api/storage/updateRecentDocOpenTime", {rootID: data.data.rootID});
            window.siyuan.mobile.editor = new Protyle(app, document.getElementById("editor"), protyleOptions);
        }
        setEditor();
        closePanel();
    });
};
