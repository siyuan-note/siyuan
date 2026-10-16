import {fetchSyncPost} from "../util/fetch";
import type {ImageOCRTextData} from "../types/api";

// 悬浮提示和按钮共享识别结果，短期过期以反映后台识别和其他客户端的修改。
const statuses = new Map<string, {expires: number, result: Promise<ImageOCRTextData | undefined>,
    text: Promise<string | undefined>, status: Promise<boolean | undefined>}>();
const cacheDuration = 60000;
const cacheLimit = 128;
let generation = 0;

const getImageOCREntry = (path: string) => {
    const cached = statuses.get(path);
    if (cached && cached.expires > Date.now()) {
        return cached;
    }
    const currentGeneration = generation;
    const result = fetchSyncPost("/api/asset/getImageOCRText", {path}, undefined, false).then(response => {
            if (response.code !== 0 || currentGeneration !== generation) {
                return undefined;
            }
            return response.data;
        }).catch((): undefined => undefined);
    const entry = {
        expires: Infinity,
        result,
        text: result.then(data => data?.text),
        status: result.then(data => data === undefined ? undefined : data.text.trim().length > 0),
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

export const getImageOCRText = (path: string): Promise<string | undefined> => getImageOCREntry(path).text;

export const getImageOCRResult = (path: string): Promise<ImageOCRTextData | undefined> => getImageOCREntry(path).result;

export const invalidateImageOCRStatus = (path: string) => {
    // 同一资源的显示参数和片段可能不同，一并清除缓存及在途读取结果。
    generation++;
    statuses.clear();
    window.dispatchEvent(new CustomEvent("siyuan-image-ocr", {detail: {path}}));
};
