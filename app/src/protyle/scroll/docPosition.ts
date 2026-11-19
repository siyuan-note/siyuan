import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";

export const getDocPosition = async (rootId: string, explicit?: IScrollAttr): Promise<IScrollAttr | undefined> => {
    if (explicit?.rootId === rootId) {
        return explicit;
    }
    const saved = window.siyuan.storage?.[Constants.LOCAL_FILEPOSITION]?.[rootId];
    if (!rootId || !saved) {
        return undefined;
    }
    try {
        const response = await fetchSyncPost("/api/attr/getBlockAttrs", {id: rootId});
        if (response.code !== 0) {
            return undefined;
        }
        const custom = response.data[Constants.CUSTOM_SY_RESTORE_DOC_POSITION];
        return (custom === "true" || (custom !== "false" && window.siyuan.config.fileTree.restoreDocPosition !== false)) ? saved : undefined;
    } catch {
        return undefined;
    }
};
