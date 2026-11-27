import {createFlashcardV2Operation} from "./flashcardV2Form";

export const createFlashcardV2AnkiImportState = () => {
    let operationFor = createFlashcardV2Operation();
    let currentFile: File;
    let closed = false;
    let active: object | undefined;
    return {
        get pending() { return active !== undefined; },
        get closed() { return closed; },
        close: () => { closed = true; },
        begin: (file: File, notebookID: string) => {
            if (closed || active || !notebookID) {
                return;
            }
            // 同一预览的文件对象保持不变；重新选择文件时不沿用旧导入操作。
            if (currentFile !== file) {
                currentFile = file;
                operationFor = createFlashcardV2Operation();
            }
            const operation = operationFor({notebookID});
            const token = {};
            active = token;
            let started = false;
            return {
                file,
                notebookID,
                operationID: operation.operationID,
                start: () => {
                    if (closed || active !== token || started) {
                        return false;
                    }
                    started = true;
                    return true;
                },
                finish: (saved: boolean) => {
                    if (active !== token) {
                        return;
                    }
                    active = undefined;
                    if (saved) {
                        operationFor = createFlashcardV2Operation();
                    }
                },
            };
        },
    };
};
