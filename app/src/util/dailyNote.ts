import {escapeAttr, escapeHtml} from "./escape";

// 笔记本名不做 HTML 过滤，拼接到对话框 HTML 前必须转义，否则名称中的标签会注入执行
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-8c2m-33v9-vvqm
export const genNotebookOptionsHTML = (notebooks: readonly {id: string, name: string, closed: boolean}[]) => {
    let optionsHTML = "";
    notebooks.forEach(item => {
        if (!item.closed) {
            optionsHTML += `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`;
        }
    });
    return optionsHTML;
};

export const getLastDailyNoteNotebookId = (
    notebooks: readonly {id: string, closed: boolean}[],
    storedNotebookId: unknown,
) => {
    if (typeof storedNotebookId !== "string" || !storedNotebookId) {
        return undefined;
    }
    return notebooks.some(item => item.id === storedNotebookId && !item.closed) ? storedNotebookId : undefined;
};
