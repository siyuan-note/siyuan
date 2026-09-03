import type {ICommandContextSnapshot, TCommandFocus} from "./types";

export const cloneCommandRange = <T extends {cloneRange: () => T}>(range?: T) => range?.cloneRange();

export const collectCommandFileTreeMetadata = <T extends {getAttribute: (name: string) => string | null}>(
    elements: T[],
) => ({
    ids: elements.map(item => item.getAttribute("data-node-id") || "").filter(Boolean),
    paths: elements.map(item => item.getAttribute("data-path") || "").filter(Boolean),
});

export const isBottomBacklinkEditorContext = (
    bottomBacklink: Pick<Element, "contains">,
    closestProtyle?: Element | false,
) => Boolean(closestProtyle && bottomBacklink.contains(closestProtyle));

export const createCommandContextSnapshot = (context: ICommandContextSnapshot): ICommandContextSnapshot => ({
    ...context,
    document: context.document ? {...context.document} : undefined,
    block: context.block ? {...context.block} : undefined,
    selectedBlocks: context.selectedBlocks.map(block => ({...block})),
    tableCell: context.tableCell ? {...context.tableCell} : undefined,
    fileTree: context.fileTree ? {
        ...context.fileTree,
        elements: [...context.fileTree.elements],
        ids: [...context.fileTree.ids],
        paths: [...context.fileTree.paths],
    } : undefined,
    activeTab: context.activeTab ? {...context.activeTab} : undefined,
    dock: context.dock ? {...context.dock} : undefined,
});

export const resolveCommandFocus = (options: {
    explicitEditor: boolean,
    explicitFileTree: boolean,
    dialogEditor: boolean,
    fileTree: boolean,
    dock: boolean,
    editor: boolean,
}): TCommandFocus => {
    if (options.explicitEditor) {
        return "editor";
    }
    if (options.explicitFileTree) {
        return "fileTree";
    }
    if (options.dialogEditor) {
        return "editor";
    }
    if (options.fileTree) {
        return "fileTree";
    }
    if (options.dock) {
        return "dock";
    }
    return options.editor ? "editor" : "global";
};
