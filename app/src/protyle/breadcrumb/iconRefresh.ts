import {getAllEditor} from "../../layout/getAll";
import {isBreadcrumbNotebookAvailable} from "./globalPath";

export const refreshBreadcrumbForIconChanges = (protyle: IProtyle, operations: IOperation[]) => {
    if (!protyle.breadcrumb || !window.siyuan.config.editor.globalBreadcrumb ||
        !isBreadcrumbNotebookAvailable(protyle.notebookId)) return;
    const changed = operations.some(operation => {
        if (operation.action === "updateAttrs") {
            const data = operation.data as {old: Record<string, string>, new: Record<string, string>};
            return data.old.icon !== data.new.icon;
        }
        if (operation.action === "setAttrs") {
            return Object.prototype.hasOwnProperty.call(JSON.parse(operation.data), "icon");
        }
        return false;
    });
    // 切换文档或移动路径期间 DOM 可能仍是旧路径，图标更新统一重新读取限定笔记本的路径。
    if (changed) void protyle.breadcrumb.render(protyle, true);
};

export const updateNotebookBreadcrumbIcon = (id: string, icon: string) => {
    const notebook = window.siyuan.notebooks?.find(item => item.id === id);
    if (!notebook || notebook.icon === icon) return;
    notebook.icon = icon;
    if (!window.siyuan.config?.editor?.globalBreadcrumb || !isBreadcrumbNotebookAvailable(id)) return;
    getAllEditor().forEach(editor => {
        if (editor.protyle.notebookId === id) void editor.protyle.breadcrumb?.render(editor.protyle, true);
    });
};
