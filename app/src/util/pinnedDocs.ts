import {fetchSyncPost} from "./fetch";

export const pinnedDocIDs = new Set<string>();

export const updatePinnedDocs = (ids: string[], action: "pin" | "unpin", targetID = "", after = false) =>
    fetchSyncPost("/api/filetree/updatePinnedDocs", {ids, action, targetID, after});
