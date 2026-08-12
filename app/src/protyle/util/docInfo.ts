export const getEmbeddedDocInfoResponse = (response: IWebSocketData): IWebSocketData | undefined => {
    if (!response.data?.docInfo) {
        return undefined;
    }
    return {
        code: 0,
        msg: "",
        data: response.data.docInfo,
    };
};
