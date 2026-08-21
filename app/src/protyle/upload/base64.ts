import {type IUploadInsertOptions, uploadFiles} from "./index";
import {getAssetUploadSuccesses} from "./uploadResult";

export const base64ToURL = async (base64SrcList: string[], protyle: IProtyle,
                                  options?: IUploadInsertOptions) => {
    const files: File[] = [];
    base64SrcList.forEach(item => {
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
    });
    if (files.length === 0) {
        return [];
    }
    return new Promise<string[]>((resolve, reject) => {
        let settled = false;
        uploadFiles(protyle, files, undefined, responseText => {
            try {
                const response = JSON.parse(responseText) as IWebSocketData;
                const paths = getAssetUploadSuccesses(response.data).map(item => item.path);
                if (paths.length !== files.length) {
                    throw new Error("Asset upload did not return every requested file");
                }
                settled = true;
                resolve(paths);
            } catch (error) {
                settled = true;
                reject(error);
            }
        }, succeeded => {
            if (!settled) {
                settled = true;
                reject(new Error(succeeded ? "Asset upload returned no result" : "Asset upload failed"));
            }
        }, {...options, requiredFileCount: files.length});
    });
};
