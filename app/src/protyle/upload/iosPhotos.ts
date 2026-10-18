import type {ILivePhotoPair} from "./livePhotoPairs";

export const canPickIOSPhotos = () => typeof window.webkit?.messageHandlers?.pickPhotos?.postMessage === "function";

export const pickIOSPhotos = async () => {
    const items = await window.webkit.messageHandlers.pickPhotos.postMessage("");
    const files: File[] = [];
    const pairs: ILivePhotoPair[] = [];
    const grouped = new Map<string, {photo?: File, video?: File}>();
    let size = 0;
    items.forEach(item => {
        const binary = atob(item.data);
        size += binary.length;
        if (size > 64 * 1024 * 1024) {
            throw new Error(window.siyuan.languages.uploadError);
        }
        const data = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            data[index] = binary.charCodeAt(index);
        }
        const file = new File([data], item.name, {type: item.mimeType});
        data.fill(0);
        files.push(file);
        if (item.pair) {
            const pair = grouped.get(item.pair) || {};
            pair[item.kind] = file;
            grouped.set(item.pair, pair);
        }
    });
    grouped.forEach(pair => {
        if (!pair.photo || !pair.video) {
            throw new Error(window.siyuan.languages.livePhotoPairUnavailable);
        }
        pairs.push({photo: pair.photo, video: pair.video});
    });
    return {files, pairs};
};
