export interface IAVLocateViewRequest {
    viewID?: string;
    persistView?: boolean;
}

export interface IAVLocateViewChange {
    viewID: string;
    previousViewID: string;
}

export const getAVLocateViewChange = (request: IAVLocateViewRequest | undefined, currentViewID: string,
                                      disabled: boolean): IAVLocateViewChange | undefined => {
    if (!request?.viewID || request.viewID === currentViewID || request.persistView === false || disabled) {
        return;
    }
    return {
        viewID: request.viewID,
        previousViewID: currentViewID,
    };
};
