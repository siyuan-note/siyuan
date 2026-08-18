export const shouldRenderBacklinkResponse = (refreshQueued: boolean, searchQueued: boolean) => {
    return !refreshQueued && !searchQueued;
};

export const shouldSaveBacklinkStatus = (init: boolean, showingLoading: boolean) => {
    return !init && !showingLoading;
};

export const shouldDeferBottomBacklinkRefresh = (panelFocused: boolean, ignoreFocus: boolean) => {
    return panelFocused && !ignoreFocus;
};

export const getBottomBacklinkVisibility = (
    linkRefsCount: number,
    mentionsCount: number,
    backlinkKeyword: string,
    mentionKeyword: string
) => {
    const hideBacklinks = linkRefsCount === 0 && !backlinkKeyword;
    const hideMentions = mentionsCount === 0 && !mentionKeyword;
    return {
        hideBacklinks,
        hideMentions,
        hidePanel: hideBacklinks && hideMentions,
    };
};

export const getInitialBacklinkSectionState = (expandCount: number, ids: string[]) => {
    return {
        folded: expandCount === -1,
        openIds: expandCount > 0 ? ids.slice(0, expandCount) : [],
    };
};

export const shouldRefreshAllBacklinkContexts = (
    rootIDs: Set<string>,
    targetRootID: string,
    blockID: string,
    explicit: boolean,
    queryChanged: boolean,
    full: boolean,
) => {
    return explicit || queryChanged || full || rootIDs.has(targetRootID) || rootIDs.has(blockID);
};
