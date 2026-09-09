import type {ICommandContextSnapshot} from "./types";

export const getCommandBlocks = (context: ICommandContextSnapshot) =>
    context.selectedBlocks.length ? context.selectedBlocks : context.block ? [context.block] : [];

export const hasCommandEditorTarget = (context: ICommandContextSnapshot) => {
    const editor = context.protyle?.wysiwyg?.element;
    const range = context.range;
    if (context.focus !== "editor" || !editor?.isConnected || !range ||
        !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        return false;
    }
    if (context.document && (context.document.rootId !== context.protyle.block.rootID ||
        context.document.notebookId !== context.protyle.notebookId)) {
        return false;
    }
    const blocks = getCommandBlocks(context);
    if (!blocks.length || blocks.some(block => !block.element.isConnected ||
        !editor.contains(block.element) || block.element.getAttribute("data-node-id") !== block.id)) {
        return false;
    }
    // 面板打开后选中集合发生变化时取消操作，避免底层函数使用新的选中目标。
    const selected = Array.from(editor.querySelectorAll(".protyle-wysiwyg--select"));
    return selected.length === context.selectedBlocks.length &&
        context.selectedBlocks.every(block => selected.includes(block.element));
};

export const getCommandDocument = (context: ICommandContextSnapshot) => {
    if (context.focus === "fileTree") {
        const elements = context.fileTree?.elements;
        if (elements?.length !== 1) {
            return undefined;
        }
        const element = elements[0];
        if (!element.isConnected || element.getAttribute("data-type") !== "navigation-file" ||
            element.getAttribute("data-node-id") !== context.fileTree.ids[0] ||
            element.getAttribute("data-path") !== context.fileTree.paths[0]) {
            return undefined;
        }
        return {
            id: context.fileTree.ids[0],
            path: context.fileTree.paths[0],
            notebookId: element.getAttribute("data-notebook-id") || element.closest("ul[data-url]")?.getAttribute("data-url"),
        };
    }
    const protyle = context.protyle;
    const doc = context.document;
    if (context.focus !== "editor" || !protyle?.element.isConnected || !doc?.rootId ||
        protyle.block.rootID !== doc.rootId || protyle.path !== doc.path || protyle.notebookId !== doc.notebookId) {
        return undefined;
    }
    return {id: doc.rootId, path: doc.path, notebookId: doc.notebookId};
};
