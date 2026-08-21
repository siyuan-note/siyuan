import {type IUploadInsertOptions, uploadFiles} from "./index";
import {getAssetUploadPathsByInput} from "./uploadResult";

export const base64ToURL = async (base64SrcList: string[], protyle: IProtyle,
                                  options?: IUploadInsertOptions) => {
    const files: File[] = [];
    const fileSourceIndices: number[] = [];
    base64SrcList.forEach((item, sourceIndex) => {
        const srcPart = item.split(",");
        if (srcPart.length !== 2) return;
        // data URL 格式为 data:image/svg+xml;base64,XXX
        const mimeMatch = srcPart[0].match(/data:([^;]+);/);
        const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
        const binary = atob(srcPart[1]);
        const u8arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            u8arr[i] = binary.charCodeAt(i);
        }
        files.push(new File([u8arr], `base64image-${Lute.NewNodeID()}.${{
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/svg+xml": "svg"
        }[mime] || "png"}`, {type: mime}));
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
