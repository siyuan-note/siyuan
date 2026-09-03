import {insertHTML} from "../util/insertHTML";
import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {destroy} from "../util/destroy";
import {escapeHtml} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";
import {getEditorRange, getUndoFocusContext, restoreFocusContext} from "../util/selection";
import {pathPosix} from "../../util/pathName";
import {genAssetHTML} from "../../asset/renderAssets";
import {hasClosestBlock, hasClosestByClassName} from "../util/hasClosest";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {getTypeByCellElement, updateCellsValue} from "../render/av/cell";
import {scrollCenter} from "../../util/highlightById";
import {confirmDialog} from "../../dialog/confirmDialog";
import {filesize} from "filesize";
import {transaction} from "../wysiwyg/transaction";
import * as dayjs from "dayjs";
import {getAVSelectedCells} from "../render/av/selectionState";
import {getAVSelectedTableCells} from "../render/av/virtualScroll";
import {createUploadInsertPosition, isUploadInsertPositionAvailable} from "./insertPosition";
import type {IUploadInsertPosition} from "./insertPosition";
import {
    type IAssetUploadEventContext,
    type IAssetUploadTask,
    prepareAssetUpload,
} from "./pluginEvent";
import {getAssetUploadResult, getAssetUploadSuccesses} from "./uploadResult";
import {AssetUploadHandlerTimeoutError, waitForUploadHandler} from "./uploadHandler";
import {getHostCapabilities} from "../../util/hostCapabilities";

interface FileWithPath extends File {
    path: string;
}

export interface IUploadInsertOptions {
    htmlAsIframe?: boolean;
    insertPosition?: IUploadInsertPosition;
    source?: TAssetUploadSource;
    target?: TAssetUploadTarget;
    position?: IAssetUploadPosition;
    /** 目标消费方要求的文件数量。 */
    requiredFileCount?: number;
    /** 目标消费方支持的输入类型。 */
    allowedInputKinds?: Array<IAssetUploadInput["kind"]>;
    /** 本机 HTML 粘贴需要沿用内核的敏感路径校验。 */
    fromHTMLPaste?: boolean;
}

export class Upload {
    public element: HTMLElement;
    public isUploading: boolean;

    constructor() {
        this.isUploading = false;
        this.element = document.createElement("div");
        this.element.className = "protyle-upload";
    }
}

const validateFile = (protyle: IProtyle, files: File[]) => {
    const uploadFileList = [];
    const rejected: IAssetUploadRejection[] = [];
    let errorTip = "";
    let uploadingStr = "";

    for (let iMax = files.length, i = 0; i < iMax; i++) {
        const file = files[i];
        let validate = true;
        const reasons: TAssetUploadRejectionReason[] = [];

        if (!file.name) {
            errorTip += `<li>${window.siyuan.languages.nameEmpty}</li>`;
            validate = false;
            reasons.push("name-empty");
        }

        if (file.size > protyle.options.upload.max) {
            errorTip += `<li>${escapeHtml(file.name)} ${window.siyuan.languages.over} ${protyle.options.upload.max / 1024 / 1024}M</li>`;
            validate = false;
            reasons.push("size-limit");
        }

        const lastIndex = file.name.lastIndexOf(".");
        const fileExt = lastIndex === -1 ? "" : file.name.substr(lastIndex);
        const filename = lastIndex === -1 ? file.name : (protyle.options.upload.filename(file.name.substr(0, lastIndex)) + fileExt);

        if (protyle.options.upload.accept) {
            const isAccept = protyle.options.upload.accept.split(",").some((item) => {
                const type = item.trim();
                if (type.indexOf(".") === 0) {
                    if (fileExt.toLowerCase() === type.toLowerCase()) {
                        return true;
                    }
                } else {
                    if (file.type.split("/")[0] === type.split("/")[0]) {
                        return true;
                    }
                }
                return false;
            });

            if (!isAccept) {
                errorTip += `<li>${escapeHtml(file.name)} ${window.siyuan.languages.fileTypeError}</li>`;
                validate = false;
                reasons.push("type-not-accepted");
            }
        }

        if (validate) {
            uploadFileList.push(file);
            uploadingStr += `<li>${escapeHtml(filename)} ${window.siyuan.languages.uploading}</li>`;
        } else {
            rejected.push({index: i, name: file.name, reasons});
        }
    }
    let msgId;
    if (errorTip !== "" || uploadingStr !== "") {
        msgId = showMessage(`<ul>${errorTip}${uploadingStr}</ul>`, -1);
    }

    return {files: uploadFileList, rejected, msgId};
};

const genUploadedLabel = async (responseText: string, protyle: IProtyle, options?: IUploadInsertOptions) => {
    const response = JSON.parse(responseText);
    let errorTip = "";

    if (response.code === 1) {
        errorTip = `${escapeHtml(String(response.msg))}`;
    }

    if (response.data.errFiles && response.data.errFiles.length > 0) {
        errorTip = `<ul><li>${errorTip}</li>`;
        response.data.errFiles.forEach((data: string) => {
            const lastIndex = data.lastIndexOf(".");
            const filename = lastIndex === -1 ? data : (protyle.options.upload.filename(data.substr(0, lastIndex)) + data.substr(lastIndex));
            errorTip += `<li>${escapeHtml(filename)} ${window.siyuan.languages.uploadError}</li>`;
        });
        errorTip += "</ul>";
    }

    if (errorTip) {
        showMessage(errorTip);
    }
    let insertBlock = true;
    const range = getUploadInsertRange(protyle, options?.insertPosition);
    if (range.toString() === "" && range.startContainer.nodeType === 3 && protyle.toolbar.getCurrentType(range).length > 0) {
        // 防止链接插入其他元素中 https://ld246.com/article/1676003478664
        range.setEndAfter(range.startContainer.parentElement);
        range.collapse(false);
    }
    const successes = getAssetUploadSuccesses(response.data);
    // https://github.com/siyuan-note/siyuan/issues/7624
    const nodeElement = hasClosestBlock(range.startContainer);
    if (nodeElement) {
        if (nodeElement.classList.contains("table")) {
            insertBlock = false;
        } else {
            const editableElement = getContenteditableElement(nodeElement);
            if (editableElement && nodeElement.classList.contains("p") &&
                (editableElement.textContent !== "" || successes.length < 2)) {
                insertBlock = false;
            }
        }
    }
    let successFileText = "";
    // 插入多个资源文件时按文件名自然升序排列 Use natural ascending order when inserting multiple assets https://github.com/siyuan-note/siyuan/issues/14643
    successes.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}) || a.index - b.index);
    const avAssets: IAVCellAssetValue[] = [];
    let hasImage = false;
    successes.forEach((success, index) => {
        const type = pathPosix().extname(success.name).toLowerCase();
        const filename = protyle.options.upload.filename(success.name);
        const name = filename.substring(0, filename.length - type.length);
        hasImage = Constants.SIYUAN_ASSETS_IMAGE.includes(type);
        avAssets.push({
            type: Constants.SIYUAN_ASSETS_IMAGE.includes(type) ? "image" : "file",
            content: success.path,
            name: name
        });
        successFileText += genAssetHTML(type, success.path, name, filename,
            getHostCapabilities().localFileSystem && options?.htmlAsIframe);
        if (!Constants.SIYUAN_ASSETS_AUDIO.includes(type) && !Constants.SIYUAN_ASSETS_VIDEO.includes(type) &&
            successes.length - 1 !== index) {
            if (nodeElement && nodeElement.classList.contains("table")) {
                successFileText += "<br>";
            } else if (insertBlock) {
                successFileText += "\n\n";
            } else {
                successFileText += "\n";
            }
        }
    });

    if (document.querySelector(".av__panel")) {
        const cellElements: HTMLElement[] = [document.querySelector('.custom-attr__avvalue[data-type="mAsset"][data-active="true"]')];
        if (!cellElements[0]) {
            cellElements.splice(0, 1);
            protyle.wysiwyg.element.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                if (getTypeByCellElement(item) === "mAsset") {
                    cellElements.push(item);
                }
            });
            if (cellElements.length === 0) {
                document.querySelector(".av__panel .b3-menu__items")?.getAttribute("data-ids")?.split(",").forEach((id: string) => {
                    const item = protyle.wysiwyg.element.querySelector(`.av__gallery-fields [data-dtype="mAsset"][data-id="${id}"]`) as HTMLElement;
                    if (item) {
                        cellElements.push(item);
                    }
                });
            }
        }
        if (cellElements.length > 0) {
            const blockElement = hasClosestBlock(cellElements[0]);
            if (blockElement) {
                await updateCellsValue(protyle, blockElement, avAssets, cellElements);
                document.querySelector(".av__panel")?.remove();
                return;
            }
        } else {
            return;
        }
    } else if (nodeElement && nodeElement.classList.contains("av")) {
        const selectedCells = getAVSelectedCells(nodeElement);
        const stableCellCandidates = (selectedCells.length > 0 ? selectedCells :
            getAVSelectedTableCells(nodeElement)).filter(item => item.column.type === "mAsset");
        const cellElements: HTMLElement[] = [];
        nodeElement.querySelectorAll(".av__row--select:not(.av__row--header)").forEach(item => {
            item.querySelectorAll(".av__cell").forEach((cellItem: HTMLElement) => {
                if (getTypeByCellElement(cellItem) === "mAsset") {
                    cellElements.push(cellItem);
                }
            });
        });
        if (cellElements.length === 0) {
            nodeElement.querySelectorAll(".av__cell--active").forEach((item: HTMLElement) => {
                if (getTypeByCellElement(item) === "mAsset") {
                    cellElements.push(item);
                }
            });
        }
        const stableCells = stableCellCandidates.length > cellElements.length ? stableCellCandidates : [];
        if (stableCells.length === 1 || cellElements.length === 1) {
            await updateCellsValue(protyle, nodeElement, avAssets, cellElements, undefined, undefined,
                false, false, false, stableCells);
        } else if (stableCells.length > 1 || cellElements.length > 1) {
            const doOperations: IOperation[] = [];
            const undoOperations: IOperation[] = [];
            let currentRowElement;
            const colId = cellElements[0]?.getAttribute("data-col-id");
            for (let i = 0; i < avAssets.length; i++) {
                const selectedCell = stableCells[i];
                if (stableCells.length > 0 && !selectedCell) {
                    break;
                }
                let cellElement = cellElements[i];
                if (!cellElement && stableCells.length === 0) {
                    if (!currentRowElement) {
                        currentRowElement = hasClosestByClassName(cellElements[i - 1], "av__row") as HTMLElement;
                    }
                    if (currentRowElement) {
                        currentRowElement = currentRowElement.nextElementSibling;
                        if (currentRowElement && currentRowElement.classList.contains("av__row")) {
                            cellElement = currentRowElement.querySelector(`.av__cell[data-col-id="${colId}"]`);
                        }
                    }
                }
                if (!cellElement && !selectedCell) {
                    break;
                }
                const operations = await updateCellsValue(protyle, nodeElement,
                    [avAssets[i]], cellElement ? [cellElement] : undefined, undefined, undefined,
                    true, false, false, selectedCell ? [selectedCell] : undefined);
                doOperations.push(...operations.doOperations);
                undoOperations.push(...operations.undoOperations);
            }
            if (doOperations.length > 0) {
                const id = nodeElement.dataset.nodeId;
                doOperations.push({
                    action: "doUpdateUpdated",
                    id,
                    data: dayjs().format("YYYYMMDDHHmmss"),
                });
                undoOperations.push({
                    action: "doUpdateUpdated",
                    id,
                    data: nodeElement.getAttribute("updated"),
                });
                transaction(protyle, doOperations, undoOperations);
            }
        }
        return;
    }
    // 避免插入代码块中，其次因为都要独立成块 https://github.com/siyuan-note/siyuan/issues/7607
    if (options?.insertPosition) {
        protyle.toolbar.range = range;
        insertHTML(successFileText, protyle, insertBlock, true);
    } else {
        insertHTML(successFileText, protyle, insertBlock);
    }
    // 粘贴图片后定位不准确 https://github.com/siyuan-note/siyuan/issues/13336
    setTimeout(() => {
        scrollCenter(protyle, undefined, "nearest", "smooth");
    }, hasImage ? 0 : Constants.TIMEOUT_LOAD);
};

export const getUploadInsertRange = (protyle: IProtyle, position?: IUploadInsertPosition) => {
    if (isUploadInsertPositionAvailable(protyle.wysiwyg.element, position)) {
        return position.range.cloneRange();
    }
    if (position?.context && restoreFocusContext(protyle, position.context)) {
        return getEditorRange(protyle.wysiwyg.element).cloneRange();
    }
    return getEditorRange(protyle.wysiwyg.element);
};

interface IAssetUploadCallbacks {
    success(responseText: string, response: IWebSocketData | undefined,
            input: IAssetUploadInput,
            result: Omit<IAssetUploadResult, "requestId" | "input">): void | PromiseLike<void>;
    formatResponse?: (responseText: string, input: IAssetUploadInput) => string;
    complete?: (succeeded: boolean) => void;
    reset?: () => void;
}

const getAssetUploadContext = (options?: IUploadInsertOptions): IAssetUploadEventContext => {
    const target = options?.target || "editor";
    return {
        source: options?.source || "programmatic",
        target,
        position: options?.position,
        requiredFileCount: options?.requiredFileCount ?? (target === "background" ? 1 : undefined),
        allowedInputKinds: options?.allowedInputKinds,
    };
};

const captureUploadInsertPosition = (protyle: IProtyle, options?: IUploadInsertOptions): IUploadInsertOptions => {
    const result = {...options};
    if ((result.target || "editor") !== "editor" || result.insertPosition) {
        return result;
    }
    let range = protyle.toolbar?.range;
    if (!range || !protyle.wysiwyg.element.contains(range.startContainer) ||
        !protyle.wysiwyg.element.contains(range.endContainer)) {
        range = getEditorRange(protyle.wysiwyg.element);
    }
    if (range && protyle.wysiwyg.element.contains(range.startContainer) &&
        protyle.wysiwyg.element.contains(range.endContainer)) {
        result.insertPosition = createUploadInsertPosition(range,
            getUndoFocusContext(protyle.wysiwyg.element, range, true));
    }
    return result;
};

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return typeof error === "string" ? error : "";
};

const finishCallbacks = (callbacks: IAssetUploadCallbacks, succeeded: boolean) => {
    try {
        callbacks.complete?.(succeeded);
    } catch (error) {
        console.error(error);
    }
    try {
        callbacks.reset?.();
    } catch (error) {
        console.error(error);
    }
};

const finishUpload = (task: IAssetUploadTask | undefined, callbacks: IAssetUploadCallbacks,
                      result: Omit<IAssetUploadResult, "requestId" | "input">) => {
    if (task && !task.complete(result)) {
        return;
    }
    finishCallbacks(callbacks, result.status === "success");
};

const finishSuccessfulUpload = (task: IAssetUploadTask | undefined, callbacks: IAssetUploadCallbacks,
                                responseText: string, response: IWebSocketData | undefined,
                                input: IAssetUploadInput,
                                result: Omit<IAssetUploadResult, "requestId" | "input">) => {
    if (task && !task.complete(result)) {
        return;
    }
    try {
        const callbackResult = callbacks.success(responseText, response, input, result);
        if (callbackResult && typeof callbackResult.then === "function") {
            void Promise.resolve(callbackResult).catch(error => {
                console.error(error);
                try {
                    showMessage(getErrorMessage(error) || window.siyuan.languages.uploadError);
                } catch (messageError) {
                    console.error(messageError);
                }
            });
        }
    } catch (error) {
        console.error(error);
        try {
            showMessage(getErrorMessage(error) || window.siyuan.languages.uploadError);
        } catch (messageError) {
            console.error(messageError);
        }
    } finally {
        finishCallbacks(callbacks, result.status === "success");
    }
};

const uploadPreparedLocalFiles = (input: Extract<IAssetUploadInput, { kind: "local-files" }>,
                                  protyle: IProtyle, isUpload: boolean, callbacks: IAssetUploadCallbacks,
                                  task?: IAssetUploadTask, options?: IUploadInsertOptions) => {
    if (!getHostCapabilities().localFileSystem) {
        finishUpload(task, callbacks, {status: "canceled"});
        return;
    }
    let msg = "";
    const assetPaths: string[] = [];
    input.files.forEach(item => {
        if (item.size && Constants.SIZE_UPLOAD_TIP_SIZE <= item.size) {
            msg += window.siyuan.languages.uploadFileTooLarge.replace("${x}", escapeHtml(item.path)).replace("${y}", filesize(item.size, {standard: "iec"})) + "<br>";
        }
        assetPaths.push(item.path);
    });

    confirmDialog(msg ? window.siyuan.languages.upload : "", msg, () => {
        void (async () => {
            let msgId: string | undefined;
            try {
                if (!document.body.contains(protyle.element)) {
                    finishUpload(task, callbacks, {status: "canceled"});
                    return;
                }
                msgId = showMessage(window.siyuan.languages.uploading, 0);
                const response = await fetchSyncPost("/api/asset/insertLocalAssets", {
                    assetPaths,
                    isUpload,
                    id: protyle.block.rootID,
                    fromHTMLPaste: options?.fromHTMLPaste,
                });
                hideMessage(msgId);
                const detached = !document.body.contains(protyle.element);
                if (detached) {
                    destroy(protyle);
                }
                if (!response.data?.succMap) {
                    finishUpload(task, callbacks, {
                        status: "failed",
                        error: String(response.msg || ""),
                    });
                    return;
                }
                let tip = "";
                getAssetUploadSuccesses(response.data).forEach(success => {
                    if (success.path.startsWith("file:")) {
                        tip += success.name + ", ";
                    }
                });
                if (tip) {
                    showMessage(window.siyuan.languages.dndFolderTip.replace("${x}",
                        `<b>${escapeHtml(tip.substring(0, tip.length - 2))}</b>`));
                }
                const responseText = JSON.stringify(response);
                const result = getAssetUploadResult(responseText, input);
                if (result.status === "failed" || detached) {
                    finishUpload(task, callbacks, result);
                } else {
                    finishSuccessfulUpload(task, callbacks, responseText, response, input, result);
                }
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                finishUpload(task, callbacks, {status: "failed", error: errorMessage});
                try {
                    if (msgId) {
                        hideMessage(msgId);
                    }
                    showMessage(errorMessage || window.siyuan.languages["_kernel"][28]);
                } catch (messageError) {
                    console.error(messageError);
                }
            }
        })();
    }, () => {
        finishUpload(task, callbacks, {status: "canceled"});
    });
};

const uploadPreparedFiles = (input: Extract<IAssetUploadInput, { kind: "files" }>, protyle: IProtyle,
                             callbacks: IAssetUploadCallbacks, task: IAssetUploadTask) => {
    const fileList = input.files;
    if (protyle.options.upload.handler) {
        const finishHandler = (result: string | null) => {
            if (typeof result === "string") {
                showMessage(result);
                finishUpload(task, callbacks, {status: "failed", error: result});
                return;
            }
            finishUpload(task, callbacks, {status: "success", acceptedInput: input});
        };
        const failHandler = (error: unknown) => {
            if (task.signal.aborted && !(error instanceof AssetUploadHandlerTimeoutError)) {
                finishUpload(task, callbacks, {status: "canceled"});
                return;
            }
            const errorMessage = getErrorMessage(error);
            finishUpload(task, callbacks, {status: "failed", error: errorMessage});
            showMessage(errorMessage || window.siyuan.languages.uploadError);
        };
        try {
            const handlerResult = protyle.options.upload.handler(fileList, {signal: task.signal});
            if (typeof handlerResult === "string" || handlerResult === null || handlerResult === undefined) {
                finishHandler(handlerResult as string | null);
            } else {
                void waitForUploadHandler(handlerResult, task.signal, undefined,
                    error => task.abort(error)).then(finishHandler, failHandler);
            }
        } catch (error) {
            failHandler(error);
        }
        return;
    }

    if (!protyle.options.upload.url || !protyle.upload) {
        showMessage("please config: options.upload.url");
        finishUpload(task, callbacks, {status: "failed"});
        return;
    }

    if (protyle.options.upload.validate) {
        const isValidate = protyle.options.upload.validate(fileList);
        if (typeof isValidate === "string") {
            showMessage(isValidate);
            finishUpload(task, callbacks, {status: "failed", error: isValidate});
            return;
        }
    }
    const validateResult = validateFile(protyle, fileList);
    if (validateResult.files.length === 0) {
        finishUpload(task, callbacks, {
            status: "failed",
            acceptedInput: {kind: "files", files: []},
            rejected: validateResult.rejected,
        });
        return;
    }
    const uploadedInput: IAssetUploadInput = {kind: "files", files: validateResult.files};

    const formData = new FormData();
    const extraData = protyle.options.upload.extraData;
    for (const key of Object.keys(extraData)) {
        formData.append(key, extraData[key]);
    }
    let msg = "";
    for (let i = 0, iMax = validateResult.files.length; i < iMax; i++) {
        formData.append(protyle.options.upload.fieldName, validateResult.files[i]);
        if (Constants.SIZE_UPLOAD_TIP_SIZE <= validateResult.files[i].size) {
            msg += window.siyuan.languages.uploadFileTooLarge.replace("${x}", escapeHtml(validateResult.files[i].name)).replace("${y}", filesize(validateResult.files[i].size, {standard: "iec"})) + "<br>";
        }
    }
    if (protyle.lite) {
        formData.append("assetsDirPath", "/assets/");
    } else {
        formData.append("id", protyle.block?.rootID);
    }
    confirmDialog(msg ? window.siyuan.languages.upload : "", msg, () => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", protyle.options.upload.url);
            if (protyle.options.upload.token) {
                xhr.setRequestHeader("X-Upload-Token", protyle.options.upload.token);
            }
            if (protyle.options.upload.withCredentials) {
                xhr.withCredentials = true;
            }

            protyle.upload.isUploading = true;
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== XMLHttpRequest.DONE) {
                    return;
                }
                try {
                    protyle.upload.isUploading = false;
                    hideMessage(validateResult.msgId);
                    const detached = !document.body.contains(protyle.element);
                    if (detached) {
                        // 网络较慢时，页签已经关闭
                        destroy(protyle);
                    }
                    if (xhr.status === 200) {
                        let responseText = xhr.responseText;
                        if (callbacks.formatResponse) {
                            responseText = callbacks.formatResponse(responseText, uploadedInput);
                        }
                        let response: IWebSocketData;
                        try {
                            response = JSON.parse(responseText);
                        } catch (error) {
                            response = undefined;
                        }
                        const result = getAssetUploadResult(responseText, uploadedInput, validateResult.rejected);
                        if (detached) {
                            finishUpload(task, callbacks, result);
                        } else {
                            finishSuccessfulUpload(task, callbacks, responseText, response, uploadedInput, result);
                        }
                    } else if (xhr.status === 0) {
                        showMessage(window.siyuan.languages["_kernel"][28]);
                        finishUpload(task, callbacks, {status: "failed"});
                    } else {
                        if (protyle.options.upload.error) {
                            protyle.options.upload.error(xhr.responseText);
                        } else {
                            showMessage(xhr.responseText);
                        }
                        finishUpload(task, callbacks, {status: "failed", error: xhr.responseText});
                    }
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    console.error(error);
                    finishUpload(task, callbacks, {status: "failed", error: errorMessage});
                    showMessage(errorMessage || window.siyuan.languages.uploadError);
                } finally {
                    protyle.upload.element.style.display = "none";
                }
            };
            xhr.upload.onprogress = (event: ProgressEvent) => {
                if (!event.lengthComputable) {
                    return;
                }
                const progress = event.loaded / event.total * 100;
                protyle.upload.element.style.display = "block";
                const progressBar = protyle.upload.element;
                progressBar.style.width = progress + "%";
            };
            xhr.send(formData);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            finishUpload(task, callbacks, {status: "failed", error: errorMessage});
            try {
                protyle.upload.isUploading = false;
                hideMessage(validateResult.msgId);
                showMessage(errorMessage || window.siyuan.languages.uploadError);
            } catch (messageError) {
                console.error(messageError);
            }
        }
    }, () => {
        try {
            hideMessage(validateResult.msgId);
        } catch (error) {
            console.error(error);
        } finally {
            finishUpload(task, callbacks, {status: "canceled"});
        }
    });
};

const startPreparedAssetUpload = (prepared: Awaited<ReturnType<typeof prepareAssetUpload>>, protyle: IProtyle,
                                  callbacks: IAssetUploadCallbacks, options: IUploadInsertOptions) => {
    if (prepared.state !== "ready") {
        finishCallbacks(callbacks, false);
        if (prepared.state === "failed") {
            showMessage(prepared.error || window.siyuan.languages.uploadError);
        }
        return;
    }
    try {
        prepared.task.startUpload(prepared.task.input.kind === "files" && Boolean(protyle.options.upload.handler));
        if (prepared.task.input.files.length === 0) {
            finishUpload(prepared.task, callbacks, {status: "canceled"});
            return;
        }
        if (!document.body.contains(protyle.element)) {
            finishUpload(prepared.task, callbacks, {status: "canceled"});
            return;
        }
        if (prepared.task.input.kind === "files") {
            uploadPreparedFiles(prepared.task.input, protyle, callbacks, prepared.task);
        } else {
            uploadPreparedLocalFiles(prepared.task.input, protyle, true, callbacks, prepared.task, options);
        }
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error(error);
        finishUpload(prepared.task, callbacks, {status: "failed", error: errorMessage});
        showMessage(errorMessage || window.siyuan.languages.uploadError);
    }
};

const startAssetUpload = (input: IAssetUploadInput, protyle: IProtyle, options: IUploadInsertOptions,
                          callbacks: IAssetUploadCallbacks) => {
    try {
        const prepared = prepareAssetUpload({
            plugins: [...(protyle.app?.plugins || [])],
            protyle,
            input,
            context: getAssetUploadContext(options),
        });
        if (prepared instanceof Promise) {
            void prepared.then(result => startPreparedAssetUpload(result, protyle, callbacks, options)).catch(error => {
                console.error(error);
                finishCallbacks(callbacks, false);
                showMessage(getErrorMessage(error) || window.siyuan.languages.uploadError);
            });
        } else {
            startPreparedAssetUpload(prepared, protyle, callbacks, options);
        }
    } catch (error) {
        console.error(error);
        finishCallbacks(callbacks, false);
        showMessage(getErrorMessage(error) || window.siyuan.languages.uploadError);
    }
};

export const uploadStandaloneAssetFiles = async (files: File[], options: {
    source: TAssetUploadSource;
    target: TAssetUploadTarget;
    requiredFileCount?: number;
    extraData?: Record<string, string | Blob>;
}) => {
    const prepared = await prepareAssetUpload({
        plugins: [...(window.siyuan.ws?.app?.plugins || [])],
        input: {kind: "files", files},
        context: {
            source: options.source,
            target: options.target,
            requiredFileCount: options.requiredFileCount,
            allowedInputKinds: ["files"],
        },
    });
    if (prepared.state !== "ready") {
        if (prepared.state === "failed") {
            showMessage(prepared.error || window.siyuan.languages.uploadError);
        }
        return;
    }
    prepared.task.startUpload();
    if (prepared.task.input.kind !== "files" || prepared.task.input.files.length === 0) {
        prepared.task.complete({status: "canceled"});
        return;
    }
    const input = prepared.task.input;
    const formData = new FormData();
    input.files.forEach(file => formData.append("file[]", file));
    Object.entries(options.extraData || {}).forEach(([key, value]) => formData.append(key, value));
    try {
        const response = await fetchSyncPost(Constants.UPLOAD_ADDRESS, formData);
        const responseText = JSON.stringify(response);
        const result = getAssetUploadResult(responseText, input);
        prepared.task.complete(result);
        if (getAssetUploadSuccesses(response.data).length === 0) {
            return;
        }
        return response;
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        prepared.task.complete({status: "failed", error: errorMessage});
        showMessage(errorMessage || window.siyuan.languages.uploadError);
    }
};

export const uploadLocalFiles = (files: ILocalFiles[], protyle: IProtyle, isUpload: boolean,
                                 options?: IUploadInsertOptions, successCB?: (response: IWebSocketData,
                                     result: Omit<IAssetUploadResult, "requestId" | "input">) => void,
                                 completeCB?: (succeeded: boolean) => void) => {
    const uploadOptions = captureUploadInsertPosition(protyle, options);
    const callbacks: IAssetUploadCallbacks = {
        success(responseText, response, _input, result) {
            if (successCB) {
                return successCB(response, result);
            } else {
                return genUploadedLabel(responseText, protyle, uploadOptions);
            }
        },
        complete: completeCB,
    };
    const input: IAssetUploadInput = {kind: "local-files", files: Array.from(files)};
    if (!isUpload) {
        uploadPreparedLocalFiles(input, protyle, false, callbacks, undefined, uploadOptions);
        return;
    }
    const linkedFiles = input.files.filter(item => {
        const name = item.path.split(/[\\/]/).pop() || "";
        return item.isDir || item.size === 0 && !name.includes(".");
    });
    const assetFiles = input.files.filter(item => !linkedFiles.includes(item));
    if (linkedFiles.length > 0) {
        uploadPreparedLocalFiles({kind: "local-files", files: linkedFiles}, protyle, false, {
            success: callbacks.success,
            complete: assetFiles.length === 0 ? callbacks.complete : undefined,
            reset: assetFiles.length === 0 ? callbacks.reset : undefined,
        }, undefined, uploadOptions);
    }
    if (assetFiles.length > 0) {
        startAssetUpload({kind: "local-files", files: assetFiles}, protyle, uploadOptions, callbacks);
    }
};

export const uploadFiles = (protyle: IProtyle, files: FileList | DataTransferItemList | File[], element?: HTMLInputElement,
                            successCB?: (res: string,
                                result: Omit<IAssetUploadResult, "requestId" | "input">) => void,
                            completeCB?: (succeeded: boolean) => void,
                            options?: IUploadInsertOptions) => {
    const uploadOptions = captureUploadInsertPosition(protyle, options);
    let fileList: File[] = [];
    for (let i = 0; i < files.length; i++) {
        let fileItem = files[i];
        if (fileItem instanceof DataTransferItem) {
            fileItem = fileItem.getAsFile();
        }
        if (!fileItem) {
            continue;
        }
        if (0 === fileItem.size && "" === fileItem.type && -1 === fileItem.name.indexOf(".")) {
            // 文件夹
            uploadLocalFiles([{
                path: (fileItem as FileWithPath).path,
                size: null,
                isDir: true,
            }], protyle, false, uploadOptions);
        } else {
            fileList.push(fileItem);
        }
    }

    if (!protyle.options.upload.handler && protyle.options.upload.file) {
        try {
            fileList = protyle.options.upload.file(fileList);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            showMessage(errorMessage || window.siyuan.languages.uploadError);
            completeCB?.(false);
            if (element) {
                element.value = "";
            }
            return;
        }
    }

    if (fileList.length === 0) {
        completeCB?.(false);
        if (element) {
            element.value = "";
        }
        return;
    }

    const callbacks: IAssetUploadCallbacks = {
        success(responseText, response, input, result) {
            if (protyle.options.upload.success) {
                return protyle.options.upload.success(protyle.wysiwyg.element, responseText);
            } else if (successCB) {
                return successCB(responseText, result);
            } else {
                return genUploadedLabel(responseText, protyle, uploadOptions);
            }
        },
        formatResponse: !protyle.options.upload.success && !successCB && protyle.options.upload.format ?
            (responseText, input) => input.kind === "files" ?
                protyle.options.upload.format(input.files, responseText) : responseText : undefined,
        complete: completeCB,
        reset() {
            if (element) {
                element.value = "";
            }
        },
    };
    startAssetUpload({kind: "files", files: fileList}, protyle, uploadOptions, callbacks);
};
