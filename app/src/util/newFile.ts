import {showMessage} from "../dialog/message";
import {hasClosestBlock, hasTopClosestByTag} from "../protyle/util/hasClosest";
/// #if !MOBILE
import {Files} from "../layout/dock/Files";
import {Editor} from "../editor";
import {openFileById} from "../editor/util";
import {getActiveTab, getDockByType} from "../layout/tabUtil";
/// #endif
import {fetchPost, fetchSyncPost} from "./fetch";
import {getOpenNotebookCount, isMoveTargetAllowed, movePathTo} from "./pathName";
import {Constants} from "../constants";
import {normalizeDocumentTitle, validateName} from "../editor/rename";
import {hideElements} from "../protyle/ui/hideElements";
import {openMobileFileById} from "../mobile/editor";
import type {App} from "../index";
import {selectAll} from "../protyle/util/selection";
import {focusByRange} from "../protyle/util/selectionOffsets";
import {
    createNewFileSelectionContext,
    isNewFileSelectionValid,
    isRangeInEditor,
    isSameBlockRange,
    isSameRange,
    NewFileSelectionContext
} from "./newFileSelection";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {createdDocumentID, documentCreateRequest, documentParentID} from "./documentCreate";
import {createConfiguredDocument, previewConfiguredDocument} from "./configuredDocument";

export const getBlockRefAnchorText = (title: string) => {
    const trimmed = (title || "").trim();
    if (!trimmed) {
        return window.siyuan.languages._kernel[16];
    }
    return trimmed.substring(0, window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen);
};

type NewDocRequest = {
    app: App;
    notebookId: string;
    currentPath: string;
    /** 是否有来自编辑器或文件树选中项的焦点目标 */
    hasFocusTarget: boolean;
    name?: string;
    sortTargetID?: string;
    sortPosition?: "before" | "after";
    listDocTree?: boolean;
    onCreated?: (id: string, title: string) => void;
};

/** 按配置路径创建文档；从聚焦编辑器或文件树推断上下文；可选 name 指定文档名 */
export const newFile = (app: App, name?: string) => {
    if (getOpenNotebookCount() === 0) {
        showMessage(window.siyuan.languages.newFileTip);
        return;
    }
    const {notebookId, currentPath, hasFocusTarget} = getNewFilePath();
    if (name === undefined) {
        runNewDoc({
            app,
            notebookId,
            currentPath,
            hasFocusTarget,
        });
    } else {
        runNewDoc({
            app,
            notebookId,
            currentPath,
            hasFocusTarget,
            name: normalizeDocumentTitle(name.trim()),
            onCreated: () => hideElements(["dialog"]),
        });
    }
};

export const newFileInProtyle = (protyle: IProtyle, onCreated: (id: string, title: string) => void) => {
    runNewDoc({
        app: protyle.app,
        notebookId: protyle.notebookId,
        currentPath: protyle.path,
        hasFocusTarget: true,
        onCreated,
    });
};

export const newFileInTree = (app: App, notebookId: string, currentPath: string, sortPlacement?: {
    targetID: string;
    position: "before" | "after";
}) => {
    runNewDocInTree({
        app,
        notebookId,
        currentPath,
        hasFocusTarget: true,
        sortTargetID: sortPlacement?.targetID,
        sortPosition: sortPlacement?.position,
        listDocTree: true,
    });
};

const insertNewFileRef = (protyle: IProtyle, context: NewFileSelectionContext, id: string, refText: string,
                          refSubtype: "d" | "s") => {
    if (!isNewFileSelectionValid(protyle, context)) {
        return;
    }
    const selection = document.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    const selectionMoved = currentRange && !isSameRange(currentRange, context.range);
    protyle.toolbar.range = context.range;
    const anchorText = refSubtype === "s" ? getBlockRefAnchorText(context.text) : refText;
    const refElements = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
        type: "id",
        color: `${id}${Constants.ZWSP}${refSubtype}${Constants.ZWSP}${anchorText}`
    }, false, context.undoContext);
    if (!refElements?.[0]) {
        return;
    }
    const refRange = protyle.toolbar.range;
    refRange.selectNodeContents(refElements[0]);
    if (selectionMoved) {
        if (isRangeInEditor(protyle.wysiwyg.element, currentRange)) {
            protyle.toolbar.range = currentRange;
            focusByRange(currentRange);
        }
    } else {
        focusByRange(refRange);
    }
};

export const newFileBySelect = (protyle: IProtyle, newFileName: string, context: NewFileSelectionContext,
                                placement: "child" | "configured", refSubtype: "d" | "s" = "d") => {
    if (!isNewFileSelectionValid(protyle, context)) {
        return;
    }
    void createConfiguredDocument({
        notebook: context.notebookId, contextID: context.rootID, purpose: "reference",
        title: newFileName, placement, reuse: true,
    }, {
        isValid: () => !!isNewFileSelectionValid(protyle, context),
        onCreated: id => insertNewFileRef(protyle, context, id, getBlockRefAnchorText(newFileName), refSubtype),
    });
};

export const newFileBySelectRange = (protyle: IProtyle, range: Range, target: "subDoc" | "configured",
                                     refSubtype: "d" | "s" = "d", name?: string,
                                     undoContext?: Record<string, string>) => {
    if (!isSameBlockRange(range)) {
        return;
    }
    const nodeElement = hasClosestBlock(range.startContainer);
    if (!nodeElement) {
        return;
    }
    const selectText = range.toString();
    if (!selectText.trim() && (nodeElement.querySelector("tr") || nodeElement.querySelector("span"))) {
        // 没选中时，都是纯文本就创建子文档 https://ld246.com/article/1663073488381/comment/1664804353295#comments
        return;
    }
    if (!selectText.trim() &&
        getContenteditableElement(nodeElement).textContent // https://github.com/siyuan-note/siyuan/issues/8099
    ) {
        selectAll(protyle, nodeElement, range);
    }
    const selectionContext = createNewFileSelectionContext(protyle, range, undoContext);
    if (!selectionContext) {
        return;
    }
    const fileName = name === undefined ? (selectText.trim() ||
        protyle.lute.BlockDOM2Content(nodeElement.outerHTML).replace(/\n/g, "").trim()) : name.trim();
    const newFileName = normalizeDocumentTitle(fileName);
    newFileBySelect(protyle, newFileName, selectionContext, target === "subDoc" ? "child" : "configured", refSubtype);
    hideElements(["toolbar"], protyle);
};



function getNewFilePath(): Pick<NewDocRequest, "notebookId" | "currentPath" | "hasFocusTarget"> {
    let notebookId = "";
    let currentPath = "";
    let hasFocusTarget = false;
    /// #if !MOBILE
    const tab = getActiveTab(false);
    if (tab?.model instanceof Editor) {
        notebookId = tab.model.editor.protyle.notebookId;
        currentPath = tab.model.editor.protyle.path;
        hasFocusTarget = true;
    }
    if (!notebookId) {
        const fileModel = getDockByType("file")?.data.file;
        if (fileModel instanceof Files) {
            const currentElement = fileModel.element.querySelector(".b3-list-item--focus");
            if (currentElement) {
                const topElement = hasTopClosestByTag(currentElement, "UL");
                if (topElement) {
                    notebookId = topElement.getAttribute("data-url");
                }
                currentPath = currentElement.getAttribute("data-path");
                hasFocusTarget = true;
            }
        }
    }
    /// #else
    if (window.siyuan.mobile.editor && document.getElementById("empty").classList.contains("fn__none")) {
        notebookId = window.siyuan.mobile.editor.protyle.notebookId;
        currentPath = window.siyuan.mobile.editor.protyle.path;
        hasFocusTarget = true;
    }
    /// #endif
    if (!notebookId) {
        const openNotebook = window.siyuan.notebooks.find(item => !item.closed);
        if (openNotebook) {
            notebookId = openNotebook.id;
            currentPath = "/";
        }
    }
    return {notebookId, currentPath, hasFocusTarget};
}

function runNewDoc(request: NewDocRequest, placement: "configured" | "child" = "configured") {
    void createConfiguredDocument({
        notebook: request.notebookId,
        contextID: request.hasFocusTarget ? documentParentID(request.currentPath || "/") : null,
        purpose: "document", title: request.name, placement,
    }, {
        sortTargetID: request.sortTargetID, sortPosition: request.sortPosition, listDocTree: request.listDocTree,
        onCreated: (id, title) => openCreatedDoc(request.app, id, request.onCreated, title),
    });
}

/** 判断配置的新建位置是否与在当前文档下直接创建子文档等价 */
export const isConfiguredCreateTargetCurrentSubDoc = async (protyle: IProtyle, type: "doc" | "ref") => {
    if (!protyle.notebookId || !protyle.path) {
        return false;
    }
    const response = await previewConfiguredDocument(protyle.notebookId, protyle.path,
        type === "doc" ? "document" : "reference", type === "ref" ? "__siyuan_ref_target__" : undefined);
    if (response.code !== 0 || !response.data || response.data.steps.length !== 1) {
        return false;
    }
    const step = response.data.steps[0];
    return step.notebook === protyle.notebookId && step.parentID === documentParentID(protyle.path) &&
        (type === "ref" || step.title.text === "");
};

function runNewDocInTree(request: NewDocRequest) {
    runNewDoc(request, "child");
}

export const getDocCreateTemplatePath = (notebookId: string, callback: (templatePath: string) => void) => {
    fetchPost("/api/filetree/getDocCreateTarget", {notebook: notebookId, purpose: "document"}, (response) => {
        callback(response.data.docCreateTemplatePath);
    });
};

function openCreatedDoc(app: App, id: string, onCreated?: (id: string, title: string) => void, title?: string) {
    if (onCreated) {
        onCreated(id, title || "");
    }
    /// #if !MOBILE
    openFileById({
        app,
        id,
        action: [Constants.CB_GET_CONTEXT, Constants.CB_GET_OPENNEW]
    });
    /// #else
    openMobileFileById(app, id, [Constants.CB_GET_CONTEXT, Constants.CB_GET_OPENNEW]);
    /// #endif
}

/**
 * 块引新建文档。
 * 
 * 与 `newFile` 入口路径解析规则对齐；创建后仅回调插入引用，不打开新文档页签。
 * 独立于 `runNewDoc` 编排，避免给通用入口引入块引专用参数。
 */
export const newFileByRefHint = (
    protyle: IProtyle,
    name: string,
    onCreated?: (id: string, title: string) => void,
    presetId?: string,
) => {
    void createConfiguredDocument({
        notebook: protyle.notebookId, contextID: documentParentID(protyle.path), purpose: "reference",
        title: normalizeDocumentTitle(name.trim()), id: presetId,
    }, {onCreated: (id, title) => onCreated?.(id, title)});
};

/** 选择本次块引新建位置，创建前后均校验原文档和选区 */
export const newFileByRefHintAtPath = (
    protyle: IProtyle,
    name: string,
    range: Range,
    onCreated: (id: string, range: Range) => void,
) => {
    const context = createNewFileSelectionContext(protyle, range);
    if (!context) {
        return;
    }
    newFileAtPath({
        notebookId: context.notebookId,
        name,
        isValid: () => !!isNewFileSelectionValid(protyle, context),
        restoreFocus: () => focusByRange(context.range),
        onCreated: (id) => onCreated(id, context.range),
    });
};

/** 在选定位置新建文档，仅在调用方上下文仍有效时创建和回调 */
export const newFileAtPath = (options: {
    notebookId: string;
    name: string;
    isValid: () => boolean;
    restoreFocus?: () => void;
    onCreated: (id: string, title: string) => void;
}) => {
    const title = normalizeDocumentTitle(options.name.trim());
    if (!options.isValid() || (title && !validateName(title, undefined, true))) {
        return;
    }
    let submitted = false;
    movePathTo({
        title: window.siyuan.languages.newFileAtPath,
        flashcard: false,
        sourceNotebookIds: [options.notebookId],
        restoreFocus() {
            if (options.isValid()) {
                options.restoreFocus?.();
            }
        },
        cb(paths, notebooks) {
            if (submitted || !paths[0] || !notebooks[0] || !options.isValid() ||
                !isMoveTargetAllowed([options.notebookId], notebooks[0])) {
                return;
            }
            submitted = true;
            createRefDocAsSubDoc({
                kind: "subDoc",
                targetNotebookId: notebooks[0],
                parentPath: paths[0],
                title,
            }, (id) => {
                if (options.isValid()) {
                    options.onCreated(id, title);
                }
            });
        },
    });
};

/** 在当前文档下新建子文档，创建后仅回调插入引用或绑定数据库条目 */
export const newSubDocByRefHint = (
    protyle: IProtyle,
    name: string,
    onCreated?: (id: string, title: string) => void,
    presetId?: string,
) => {
    createRefDocAsSubDoc({
        kind: "subDoc", targetNotebookId: protyle.notebookId, parentPath: protyle.path,
        title: normalizeDocumentTitle(name.trim()),
    }, onCreated, presetId);
};



function createRefDocAsSubDoc(
    target: {kind: "subDoc"; targetNotebookId: string; parentPath: string; title: string},
    onCreated?: (id: string, title: string) => void,
    presetId?: string,
) {
    const id = presetId || Lute.NewNodeID();
    void fetchSyncPost("/api/filetree/createDocByParent",
        documentCreateRequest(target.targetNotebookId, target.parentPath, id, target.title)).then(response => {
        const createdID = createdDocumentID(response.data);
        if (createdID) {
            onCreated?.(createdID, target.title || "");
        }
    }).catch(error => {
        showMessage(error.message);
    });
}
