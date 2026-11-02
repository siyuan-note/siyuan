import {fetchSyncPost} from "../../../util/fetch";
import type {IDocTreeDataSource} from "./types";
import {showMessage} from "../../../dialog/message";

// 内核在源持续变化时可能无法构造快照，只重试这一明确的暂态错误，保留其他读取失败。
const retryDocTreeChange = async <T extends {code: number, msg?: string}>(request: () => Promise<T>, ignoreUnavailable = false): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
        const response = await request();
        const changed = response.code === -1 && response.msg === "document tree changed, please retry";
        if (!changed || attempt >= 2) {
            const unavailable = ignoreUnavailable && response.code === -1 && response.msg === "document tree item is unavailable";
            if (!changed && !unavailable && response.code < 0) {
                showMessage(response.msg, 0, response.code === -1 ? "error" : "info");
            }
            return response;
        }
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
};

export const docTreeDataSource: IDocTreeDataSource = {
    async range(request) {
        const response = await retryDocTreeChange(() => fetchSyncPost("/api/filetree/listDocTreeRange", request, undefined, false));
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        return response.data;
    },
    async locate(request, options) {
        const response = await retryDocTreeChange(() => fetchSyncPost("/api/filetree/locateDocTreeItem", request, undefined, false), options?.ignoreUnavailable);
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        return response.data;
    },
};
