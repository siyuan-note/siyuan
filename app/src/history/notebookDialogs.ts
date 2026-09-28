import type {Dialog} from "../dialog";

const dialogs = new Map<Dialog, Set<string>>();

export const trackNotebookHistoryDialog = (dialog: Dialog, notebooks: string[]) => {
    dialogs.set(dialog, new Set(notebooks));
};

export const forgetNotebookHistoryDialog = (dialog: Dialog) => {
    dialogs.delete(dialog);
};

export const closeNotebookHistoryDialogs = (notebook: string) => {
    // 从上层详情开始关闭，避免焦点返回已经销毁的下层对话框。
    Array.from(dialogs.entries()).reverse().forEach(([dialog, notebooks]) => {
        if (notebooks.has(notebook)) {
            dialog.destroy();
            dialogs.delete(dialog);
        }
    });
};
