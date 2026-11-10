import type {Protyle} from "../index";

const dialogs = new Map<Protyle, {id: string, notebook?: string, close: () => void}>();

export const registerDocumentTitleDialog = (editor: Protyle, id: string, notebook: string | undefined, close: () => void) => {
    dialogs.set(editor, {id, notebook, close});
    return () => dialogs.delete(editor);
};

// 内核确认源失效后立即清除对话框；尚未完成身份加载的对话框也不能继续展示迟到响应。
export const closeDocumentTitleDialogs = (scope: {notebookId?: string, rootIDs?: string[]}) => {
    Array.from(dialogs.entries()).reverse().forEach(([editor, record]) => {
        const notebook = editor.protyle.notebookId || record.notebook;
        if (scope.notebookId && (!notebook || notebook === scope.notebookId) ||
            scope.rootIDs?.includes(record.id)) {
            record.close();
        }
    });
};
