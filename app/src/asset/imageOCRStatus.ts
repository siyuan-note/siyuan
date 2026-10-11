import {fetchSyncPost} from "../util/fetch";

// 悬浮提示和按钮共享识别结果，短期过期以反映后台识别和其他客户端的修改。
const statuses = new Map<string, {expires: number, result: Promise<string | undefined>, status: Promise<boolean | undefined>}>();
const cacheDuration = 60000;
const cacheLimit = 128;

const getImageOCREntry = (path: string) => {
    const cached = statuses.get(path);
    if (cached && cached.expires > Date.now()) {
        return cached;
    }
    const result = fetchSyncPost("/api/asset/getImageOCRText", {path}, undefined, false).then(response => {
            if (response.code !== 0) {
                return undefined;
            }
            return response.data.text;
        }).catch(() => undefined);
    const entry = {
        expires: Infinity,
        result,
        status: result.then(text => text === undefined ? undefined : text.trim().length > 0),
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
    return entry;
};

export const getImageOCRStatus = (path: string): Promise<boolean | undefined> => getImageOCREntry(path).status;

export const getImageOCRText = (path: string): Promise<string | undefined> => getImageOCREntry(path).result;

export const invalidateImageOCRStatus = (path: string) => {
    statuses.delete(path);
    window.dispatchEvent(new CustomEvent("siyuan-image-ocr"));
};
