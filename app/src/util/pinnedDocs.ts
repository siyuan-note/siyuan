import {fetchSyncPost} from "./fetch";
import {getConfiguredEntryVisibility, setEntryVisibilityValue} from "../config/entryVisibility/runtime";

export const pinnedDocIDs = new Set<string>();

export const updatePinnedDocs = async (ids: string[], action: "pin" | "unpin", targetID = "", after = false) => {
    const response = await fetchSyncPost("/api/filetree/updatePinnedDocs", {ids, action, targetID, after});
    if (response.code === 0 && action === "pin" && !getConfiguredEntryVisibility("documentPanel.pinnedDocs")) {
        setEntryVisibilityValue("documentPanel.pinnedDocs", true);
    }
    return response;
};
