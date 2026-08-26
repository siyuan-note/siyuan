import {type IUploadInsertOptions, uploadFiles} from "./index";
import {getAssetUploadPathsByInput} from "./uploadResult";
import {
    addBase64ImageBatchSize,
    assertBase64ImageItemSize,
    createBase64ImageFile,
    getBase64ImageDecodedSize,
    isBase64ImageSizeLimitError,
} from "./base64File";
import {showMessage} from "../../dialog/message";

export const showBase64ImageSizeLimit = (error: unknown) => {
    if (!isBase64ImageSizeLimitError(error)) {
        return false;
    }
    showMessage(`<ul><li>Base64 ${window.siyuan.languages.over} ${error.maxBytes / 1024 / 1024}M</li></ul>`);
    return true;
};

export const base64ToURL = async (base64SrcList: string[], protyle: IProtyle,
                                  options?: IUploadInsertOptions) => {
    const files: File[] = [];
    const fileSourceIndices: number[] = [];
    let totalBytes = 0;
    base64SrcList.forEach(item => {
        const size = getBase64ImageDecodedSize(item);
        if (size === undefined) {
            return;
        }
        assertBase64ImageItemSize(size, protyle.options.upload.max);
        totalBytes = addBase64ImageBatchSize(totalBytes, size);
    });
    base64SrcList.forEach((item, sourceIndex) => {
        const file = createBase64ImageFile(item, `base64image-${Lute.NewNodeID()}`, protyle.options.upload.max);
        if (!file) {
            return;
        }
        files.push(file);
        fileSourceIndices.push(sourceIndex);
    });
    const paths: Array<string | undefined> = new Array(base64SrcList.length).fill(undefined);
    if (files.length === 0) {
        return paths;
    }
    return new Promise<Array<string | undefined>>((resolve) => {
        let settled = false;
        uploadFiles(protyle, files, undefined, (_responseText, result) => {
            getAssetUploadPathsByInput(files.length, result).forEach((path, fileIndex) => {
                paths[fileSourceIndices[fileIndex]] = path;
            });
            settled = true;
            resolve(paths);
        }, () => {
            if (!settled) {
                settled = true;
                resolve(paths);
            }
        }, {...options, requiredFileCount: files.length});
    });
};
