import {fetchSyncPost} from "./fetch";
import {Constants} from "../constants";

export const getCompressURL = (url: string) => {
    if (url.startsWith("assets/") &&
        (url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg"))) {
        return url + "?style=thumb";
    }
    return url;
};

export const removeCompressURL = (url: string) => {
    if (url.startsWith("assets/") &&
        (url.endsWith(".png?style=thumb") || url.endsWith(".jpg?style=thumb") || url.endsWith(".jpeg?style=thumb"))) {
        return url.replace("?style=thumb", "");
    }
    return url;
};

export const base64ToURL = async (base64SrcList: string[]) => {
    const formData = new FormData();
    base64SrcList.forEach(item => {
        const srcPart = item.split(",");
        if (srcPart.length !== 2) return;
        // data:image/svg+xml;base64,XXX
        const mimeMatch = srcPart[0].match(/data:([^;]+);/);
        const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
        const binary = atob(srcPart[1]);
        const u8arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            u8arr[i] = binary.charCodeAt(i);
        }
        formData.append("file[]", new File([u8arr], `base64image-${Lute.NewNodeID()}.${{
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/svg+xml": "svg"
        }[mime] || "png"}`, {type: mime}));
    });
    const response = await fetchSyncPost(Constants.UPLOAD_ADDRESS, formData);
    const URLs: string[] = [];
    Object.keys(response.data.succMap).forEach((item) => {
        URLs.push(response.data.succMap[item]);
    });
    return URLs;
};
