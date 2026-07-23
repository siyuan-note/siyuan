export const shouldForceBacklinkRefresh = (ownerRootID: string, changedRootID: string) => {
    return Boolean(ownerRootID && ownerRootID === changedRootID);
};
