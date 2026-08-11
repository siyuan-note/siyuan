export interface IBlockPanelItemInfo {
    notebookId?: string;
    rootID?: string;
}

export interface IBlockPanelRemovalOptions {
    notebookId?: string;
    rootIDs: ReadonlySet<string>;
}

export const matchesBlockPanelRemoval = (info: IBlockPanelItemInfo | undefined,
                                         options: IBlockPanelRemovalOptions) => {
    if (!info) {
        return false;
    }
    return (!!options.notebookId && info.notebookId === options.notebookId) ||
        (!!info.rootID && options.rootIDs.has(info.rootID));
};

export const planBlockPanelRemoval = <T>(items: readonly T[],
                                         getInfo: (item: T) => IBlockPanelItemInfo | undefined,
                                         options: IBlockPanelRemovalOptions) => {
    const removeItems: T[] = [];
    const unresolvedItems: T[] = [];
    items.forEach((item) => {
        const info = getInfo(item);
        if (matchesBlockPanelRemoval(info, options)) {
            removeItems.push(item);
        } else if (!info) {
            unresolvedItems.push(item);
        }
    });
    return {removeItems, unresolvedItems};
};

export const removeBlockPanelEditors = (options: {notebookId?: string, rootIDs?: string[]}) => {
    const removalOptions = {
        notebookId: options.notebookId,
        rootIDs: new Set(options.rootIDs || []),
    };
    if (!removalOptions.notebookId && removalOptions.rootIDs.size === 0) {
        return;
    }
    [...window.siyuan.blockPanels].forEach(item => item.removeEditors(removalOptions));
};
