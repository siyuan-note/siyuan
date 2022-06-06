import {insertHTML} from "../util/insertHTML";
import {hideMessage, showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {destroy} from "../util/destroy";
import {fetchPost} from "../../util/fetch";
import {getEditorRange} from "../util/selection";

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
    let errorTip = "";
    let uploadingStr = "";

    for (let iMax = files.length, i = 0; i < iMax; i++) {
        const file = files[i];
        let validate = true;

        if (!file.name) {
            errorTip += `<li>${window.siyuan.languages.nameEmpty}</li>`;
            validate = false;
        }

        if (file.size > protyle.options.upload.max) {
            errorTip += `<li>${file.name} ${window.siyuan.languages.over} ${protyle.options.upload.max / 1024 / 1024}M</li>`;
            validate = false;
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
                errorTip += `<li>${file.name} ${window.siyuan.languages.fileTypeError}</li>`;
                validate = false;
            }
        }

        if (validate) {
            uploadFileList.push(file);
            uploadingStr += `<li>${filename} ${window.siyuan.languages.uploading}</li>`;
        }
    }
    let msgId
    if (errorTip !== "" || uploadingStr !== "") {
        msgId = showMessage(`<ul>${errorTip}${uploadingStr}</ul>`);
    }

    return {files: uploadFileList, msgId};
};

const genUploadedLabel = (responseText: string, protyle: IProtyle) => {
    const response = JSON.parse(responseText);
    let errorTip = "";

    if (response.code === 1) {
        errorTip = `${response.msg}`;
    }

    if (response.data.errFiles && response.data.errFiles.length > 0) {
        errorTip = `<ul><li>${errorTip}</li>`;
        response.data.errFiles.forEach((data: string) => {
            const lastIndex = data.lastIndexOf(".");
            const filename = lastIndex === -1 ? data : (protyle.options.upload.filename(data.substr(0, lastIndex)) + data.substr(lastIndex));
            errorTip += `<li>${filename} ${window.siyuan.languages.uploadError}</li>`;
        });
        errorTip += "</ul>";
    }

    if (errorTip) {
        showMessage(errorTip);
    }

    let succFileText = "";
    const keys = Object.keys(response.data.succMap);
    keys.forEach((key, index) => {
        const path = response.data.succMap[key];
        const lastIndex = key.lastIndexOf(".");
        let type = key.substr(lastIndex);
        let filename = protyle.options.upload.filename(key.substr(0, lastIndex)) + type;
        if (-1 === lastIndex) {
            type = "";
            filename = protyle.options.upload.filename(key);
        }
        type = type.toLowerCase();
        if (Constants.SIYUAN_ASSETS_AUDIO.includes(type)) {
            succFileText += `<audio controls="controls" src="${path}"></audio>`;
        } else if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
            succFileText += `![${filename}](${path})`;
        } else if (Constants.SIYUAN_ASSETS_VIDEO.includes(type)) {
            succFileText += `<video controls="controls" src="${path}"></video>`;
        } else {
            succFileText += `[${filename}](${path})`;
        }
        if (keys.length - 1 !== index) {
            succFileText += "\n";
        }
    });
    const range = getEditorRange(protyle.wysiwyg.element);
    if (!succFileText.startsWith("<") && range.toString() === "" && range.startContainer.nodeType === 3 && protyle.toolbar.getCurrentType(range).length > 0) {
        // 防止链接插入其他元素中
        range.setEndAfter(range.startContainer.parentElement);
        range.collapse(false);
    }
    insertHTML(protyle.lute.SpinBlockDOM(succFileText), protyle);
};

export const uploadLocalFiles = (files: string[], protyle: IProtyle) => {
    const id = showMessage(window.siyuan.languages.uploading, 0);
    fetchPost("/api/asset/insertLocalAssets", {
        assetPaths: files,
        id: protyle.block.rootID
    }, (response) => {
        hideMessage(id)
        genUploadedLabel(JSON.stringify(response), protyle);
    });
};

export const uploadFiles = (protyle: IProtyle, files: FileList | DataTransferItemList | File[], element?: HTMLInputElement, successCB?: (res: string) => void) => {
    // FileList | DataTransferItemList | File[] => File[]
    let fileList = [];
    for (let i = 0; i < files.length; i++) {
        let fileItem = files[i];
        if (fileItem instanceof DataTransferItem) {
            fileItem = fileItem.getAsFile();
        }
        if (0 === fileItem.size && "" === fileItem.type && -1 === fileItem.name.indexOf(".")) {
            // 文件夹
            document.execCommand("insertHTML", false, `[${fileItem.name}](file://${fileItem.path})`);
        } else {
            fileList.push(fileItem);
        }
    }

    if (protyle.options.upload.handler) {
        const isValidate = protyle.options.upload.handler(fileList);
        if (typeof isValidate === "string") {
            showMessage(isValidate);
            return;
        }
        return;
    }

    if (!protyle.options.upload.url || !protyle.upload) {
        if (element) {
            element.value = "";
        }
        showMessage("please config: options.upload.url");
        return;
    }

    if (protyle.options.upload.file) {
        fileList = protyle.options.upload.file(fileList);
    }

    if (protyle.options.upload.validate) {
        const isValidate = protyle.options.upload.validate(fileList);
        if (typeof isValidate === "string") {
            showMessage(isValidate);
            return;
        }
    }
    const editorElement = protyle.wysiwyg.element;

    const validateResult = validateFile(protyle, fileList);
    if (validateResult.files.length === 0) {
        if (element) {
            element.value = "";
        }
        return;
    }

    const formData = new FormData();

    const extraData = protyle.options.upload.extraData;
    for (const key of Object.keys(extraData)) {
        formData.append(key, extraData[key]);
    }

    for (let i = 0, iMax = validateResult.files.length; i < iMax; i++) {
        formData.append(protyle.options.upload.fieldName, validateResult.files[i]);
    }
    formData.append("id", protyle.block.rootID);
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
        if (xhr.readyState === XMLHttpRequest.DONE) {
            protyle.upload.isUploading = false;
            if (!document.body.contains(protyle.element)) {
                // 网络较慢时，页签已经关闭
                destroy(protyle);
                return;
            }
            if (xhr.status === 200) {
                hideMessage(validateResult.msgId);
                if (protyle.options.upload.success) {
                    protyle.options.upload.success(editorElement, xhr.responseText);
                } else if (successCB) {
                    successCB(xhr.responseText);
                } else {
                    let responseText = xhr.responseText;
                    if (protyle.options.upload.format) {
                        responseText = protyle.options.upload.format(files as File [], xhr.responseText);
                    }
                    genUploadedLabel(responseText, protyle);
                }
            } else if (xhr.status === 0) {
                showMessage(window.siyuan.languages.fileTypeError);
            } else {
                if (protyle.options.upload.error) {
                    protyle.options.upload.error(xhr.responseText);
                } else {
                    showMessage(xhr.responseText);
                }
            }
            if (element) {
                element.value = "";
            }
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
};
