import {hideMessage, showMessage} from "../dialog/message";
import {fetchSyncPost} from "../util/fetch";
import {genUUID} from "../util/genID";
import {invalidateImageOCRStatus} from "./imageOCRStatus";
import {openImageOCR} from "./imageOCR";

const pending = new Set<string>();

export const reImageAIOCR = async (path: string) => {
    if (pending.has(path)) {
        return;
    }
    pending.add(path);
    const messageId = genUUID();
    showMessage(window.siyuan.languages.loading, -1, "info", messageId);
    try {
        const response = await fetchSyncPost("/api/ai/ocr", {path});
        if (response.code === 0) {
            invalidateImageOCRStatus(path);
            openImageOCR(path);
        }
    } catch (error) {
        showMessage(error.message, 7000, "error");
    } finally {
        pending.delete(path);
        hideMessage(messageId);
    }
};
