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
import {getDocByScroll, saveScroll} from "../protyle/scroll/saveScroll";

export const getCurrentEditor = () => {
    return window.siyuan.mobile.popEditor || window.siyuan.mobile.editor;
};

export const openMobileFileById = (app: App, id: string, action: TProtyleAction[] = [Constants.CB_GET_HL], scrollPosition?: ScrollLogicalPosition) => {
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
        if (blockElement) {
            pushBack();
            if (action.includes(Constants.CB_GET_HL)) {
                highlightById(window.siyuan.mobile.editor.protyle, id, scrollPosition);
            } else {
                scrollCenter(window.siyuan.mobile.editor.protyle, blockElement, scrollPosition);
            }
            closePanel();
            // 更新文档浏览时间
            fetchPost("/api/storage/updateRecentDocViewTime", {rootID: window.siyuan.mobile.editor.protyle.block.rootID});
            return;
        }
    }

    fetchPost("/api/block/getBlockInfo", {id}, (data) => {
        if (data.code === 3) {
            showMessage(data.msg);
            return;
        }
        const protyleOptions: IProtyleOptions = {
            blockId: id,
            rootId: data.data.rootID,
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
            }
        };
        if (window.siyuan.mobile.editor) {
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
                    }
                });
            } else {
                fetchPost("/api/filetree/getDoc", {
                    id,
                    size: action.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
                    mode: action.includes(Constants.CB_GET_CONTEXT) ? 3 : 0,
                }, getResponse => {
                    onGet({
                        data: getResponse,
                        protyle: window.siyuan.mobile.editor.protyle,
                        action,
                        scrollPosition,
                        afterCB() {
                            app.plugins.forEach(item => {
                                item.eventBus.emit("switch-protyle", {protyle: window.siyuan.mobile.editor.protyle});
                            });
                        }
                    });
                });
            }
            window.siyuan.mobile.editor.protyle.undo.clear();
        } else {
            fetchPost("/api/storage/updateRecentDocOpenTime", {rootID: data.data.rootID});
            window.siyuan.mobile.editor = new Protyle(app, document.getElementById("editor"), protyleOptions);
        }
        setEditor();
        closePanel();
    });
};
