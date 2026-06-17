import type {App} from "../index";
import {hideMessage} from "../dialog/message";
import {hideElements} from "../protyle/ui/hideElements";
import {setEmpty} from "../mobile/util/setEmpty";
import {fetchPost} from "./fetch";
import {Constants} from "../constants";
import {getDocDisplayName, setNoteBook} from "./pathName";
import {getAllModels} from "../layout/getAll";
import {setStorageVal} from "../protyle/util/compatibility";
import type {Tab} from "../layout/Tab";
import {setTitle} from "./processTitle";

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
    if (window.siyuan.mobile.popEditor && window.siyuan.mobile.popEditor.protyle) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.popEditor.protyle.block.rootID)) {
            hideElements(["dialog"]);
        } else {
            window.siyuan.mobile.popEditor.reload(false, updateReadonly);
        }
    }
    if (document.getElementById("empty").classList.contains("fn__none") &&
        window.siyuan.mobile.editor && window.siyuan.mobile.editor.protyle) {
        if (data.removeRootIDs.includes(window.siyuan.mobile.editor.protyle.block.rootID)) {
            setEmpty(app);
        } else {
            window.siyuan.mobile.editor.reload(false, updateReadonly);
            fetchPost("/api/block/getDocInfo", {
                id: window.siyuan.mobile.editor.protyle.block.rootID
            }, (response) => {
                setTitle(response.data.name);
                window.siyuan.mobile.editor.protyle.title.setTitle(response.data.name, response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true");
            });
        }
    }
    setNoteBook(() => {
        window.siyuan.mobile.docks.file.init(false);
    });
    /// #else
    const allModels = getAllModels();
    const updateTitle = (rootID: string, tab: Tab, protyle?: IProtyle) => {
        fetchPost("/api/block/getDocInfo", {
            id: rootID
        }, (response) => {
            const titleEmpty = response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true";
            tab.updateTitle(getDocDisplayName(response.data.name, titleEmpty));
            if (protyle && protyle.title) {
                protyle.title.setTitle(response.data.name, titleEmpty);
            }
        });
    };
    allModels.editor.forEach(item => {
        if (data.upsertRootIDs.includes(item.editor.protyle.block.rootID)) {
            fetchPost("/api/block/getDocInfo", {
                id: item.editor.protyle.block.rootID,
            }, (response) => {
                item.editor.protyle.wysiwyg.renderCustom(response.data.ial);
                item.editor.reload(false, updateReadonly);
                updateTitle(item.editor.protyle.block.rootID, item.parent, item.editor.protyle);
            });
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
            item.searchGraph(false);
            if (item.type === "local") {
                updateTitle(item.rootId, item.parent);
            }
        }
    });
    allModels.outline.forEach(item => {
        if (item.type === "local" && data.removeRootIDs.includes(item.blockId)) {
            item.parent.parent.removeTab(item.parent.id, false, false);
        } else if (item.type !== "local" || data.upsertRootIDs.includes(item.blockId)) {
            fetchPost("/api/outline/getDocOutline", {
                id: item.blockId,
                preview: item.isPreview
            }, response => {
                item.update(response);
            });
            if (item.type === "local") {
                updateTitle(item.blockId, item.parent);
            }
        }
    });
    allModels.backlink.forEach(item => {
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
