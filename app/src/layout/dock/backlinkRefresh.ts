export const shouldForceBacklinkRefresh = (ownerRootID: string, changedRootID: string) => {
    return Boolean(ownerRootID && ownerRootID === changedRootID);
};

export const shouldRenderBacklinkResponse = (refreshQueued: boolean, searchQueued: boolean) => {
    return !refreshQueued && !searchQueued;
};

export const shouldSaveBacklinkStatus = (init: boolean, showingLoading: boolean) => {
    return !init && !showingLoading;
};
