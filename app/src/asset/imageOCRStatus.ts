import {fetchSyncPost} from "../util/fetch";

// 仅缓存按钮显示状态，短期过期以反映后台识别和其他客户端的修改。
const statuses = new Map<string, {expires: number, result: Promise<boolean | undefined>}>();
const cacheDuration = 60000;
const cacheLimit = 128;

export const getImageOCRStatus = (path: string): Promise<boolean | undefined> => {
    const cached = statuses.get(path);
    if (cached && cached.expires > Date.now()) {
        return cached.result;
    }
    const entry = {
        expires: Infinity,
        result: fetchSyncPost("/api/asset/getImageOCRText", {path}, undefined, false).then(response => {
            if (response.code !== 0) {
                return undefined;
            }
            return response.data.text.trim().length > 0;
        }).catch(() => undefined),
    };
    statuses.delete(path);
    statuses.set(path, entry);
    if (statuses.size > cacheLimit) {
        statuses.delete(statuses.keys().next().value);
    }
    entry.result.then(result => {
        if (statuses.get(path) !== entry) {
            return;
        }
        if (result === undefined) {
            statuses.delete(path);
        } else {
            entry.expires = Date.now() + cacheDuration;
        }
    });
    return entry.result;
};

export const invalidateImageOCRStatus = (path: string) => {
    statuses.delete(path);
    window.dispatchEvent(new CustomEvent("siyuan-image-ocr"));
};
