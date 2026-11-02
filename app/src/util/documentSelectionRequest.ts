import {withDocumentSelection} from "./configuredDocument";
import {showMessage} from "../dialog/message";
import {escapeHtml} from "./escape";
import type {DocumentSelectionInput} from "../types/api";

export const fetchWithDocumentSelection = async <T extends {code: number; msg: string; data?: unknown}>(
    submit: (selection?: DocumentSelectionInput) => Promise<T>,
    options: {notebooks: string[]; isValid?: () => boolean; signal?: AbortSignal}): Promise<T | undefined> => {
    const valid = () => !options.signal?.aborted && (!options.isValid || options.isValid());
    try {
        const response = await withDocumentSelection(options.notebooks, submit, valid);
        if (response && response.code < 0) {
            showMessage(escapeHtml(response.msg), 0, "error");
            return;
        }
        return response;
    } catch (error) {
        if (valid() && error?.name !== "AbortError") showMessage(escapeHtml(error.message), 0, "error");
    }
};
