export interface IBlockPanelLoadPlan {
    isDocument: boolean;
    useBacklinkContext: boolean;
}

export const getBlockPanelLoadPlan = (rootID: string, refID: string, isBacklink: boolean): IBlockPanelLoadPlan => {
    const isDocument = rootID === refID;
    return {
        isDocument,
        useBacklinkContext: isBacklink && !isDocument,
    };
};
