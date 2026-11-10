import type {ICommandContextSnapshot} from "./types";
import {hasClosestBlock} from "../protyle/util/hasClosest";
import {getDocTreeActionItems} from "../menus/navigationSelection";

export const getCommandBlocks = (context: ICommandContextSnapshot) =>
    context.selectedBlocks.length ? context.selectedBlocks : context.block ? [context.block] : [];

export const hasCommandFileTreeTarget = (context: ICommandContextSnapshot) => {
    const tree = context.fileTree;
    if (context.focus !== "fileTree" || !tree) {
        return false;
    }
    return Boolean(tree.controller && tree.items && tree.controller.validateSelection(tree.selectionVersion, tree.items));
};

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
    const selected = Array.from(new Set(Array.from(editor.querySelectorAll(".protyle-wysiwyg--select"))
        .map(element => hasClosestBlock(element, true) || element)));
    return selected.length === context.selectedBlocks.length &&
        context.selectedBlocks.every(block => selected.includes(block.element));
};

export const getCommandDocument = (context: ICommandContextSnapshot) => {
    if (context.focus === "fileTree") {
        const tree = context.fileTree;
        if (tree?.controller) {
            if (!hasCommandFileTreeTarget(context)) {
                return undefined;
            }
            const items = getDocTreeActionItems(tree.items);
            if (items.length !== 1 || items[0].kind !== "document") {
                return undefined;
            }
            const {id, path, notebookId} = items[0];
            return {id, path, notebookId};
        }
        return undefined;
    }
    const protyle = context.protyle;
    const doc = context.document;
    if (context.focus !== "editor" || !protyle?.element.isConnected || !doc?.rootId ||
        protyle.block.rootID !== doc.rootId || protyle.path !== doc.path || protyle.notebookId !== doc.notebookId) {
        return undefined;
    }
    return {id: doc.rootId, path: doc.path, notebookId: doc.notebookId};
};
