import {fetchSyncPost} from "../../../util/fetch";
import type {IDocTreeDataSource} from "./types";

export const docTreeDataSource: IDocTreeDataSource = {
    async range(request) {
        const response = await fetchSyncPost("/api/filetree/listDocTreeRange", request);
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        return response.data;
    },
    async locate(request) {
        const response = await fetchSyncPost("/api/filetree/locateDocTreeItem", request);
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
        return response.data;
    },
};
