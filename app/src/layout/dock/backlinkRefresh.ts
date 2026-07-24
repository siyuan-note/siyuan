export const shouldRenderBacklinkResponse = (refreshQueued: boolean, searchQueued: boolean) => {
    return !refreshQueued && !searchQueued;
};

export const shouldSaveBacklinkStatus = (init: boolean, showingLoading: boolean) => {
    return !init && !showingLoading;
};

export const shouldDeferBottomBacklinkRefresh = (ownerFocused: boolean, ignoreFocus: boolean) => {
    return ownerFocused && !ignoreFocus;
};

export const shouldHideBottomBacklinks = (
    linkRefsCount: number,
    mentionsCount: number,
    backlinkKeyword: string,
    mentionKeyword: string
) => {
    return linkRefsCount === 0 && mentionsCount === 0 && !backlinkKeyword && !mentionKeyword;
};
