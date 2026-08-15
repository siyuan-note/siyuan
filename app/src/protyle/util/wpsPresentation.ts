const MAX_WPS_PRESENTATION_ARCHIVE_LENGTH = 8 * 1024 * 1024;

export const MAX_WPS_PRESENTATION_DATA_LENGTH = Math.ceil(MAX_WPS_PRESENTATION_ARCHIVE_LENGTH / 3) * 4;

const MAX_WPS_PRESENTATION_JSON_LENGTH = MAX_WPS_PRESENTATION_DATA_LENGTH + 64 * 1024;

export type WPSPresentationClipboardType = "texts" | "objects";

export interface IWPSPresentationClipboard {
    data: string;
    type: WPSPresentationClipboardType;
}

export const parseWPSPresentationClipboard = (json: string, type: WPSPresentationClipboardType,
                                               maxDataLength = MAX_WPS_PRESENTATION_DATA_LENGTH) => {
    if (!json || json.length > maxDataLength + 64 * 1024) {
        return;
    }
    try {
        const payload = JSON.parse(json) as { data?: unknown };
        if (typeof payload.data !== "string" || payload.data.trim() === "" || payload.data.length > maxDataLength) {
            return;
        }
        return {
            data: payload.data,
            type,
        } as IWPSPresentationClipboard;
    } catch (e) {
        return;
    }
};

export const extractWPSPresentationClipboard = (types: ArrayLike<string>, getData: (type: string) => string) => {
    const availableTypes = Array.from(types);
    for (const type of ["texts", "objects"] as WPSPresentationClipboardType[]) {
        const mime = availableTypes.find((item) => item.toLowerCase() === `wps/${type}`);
        if (!mime) {
            continue;
        }
        try {
            const json = getData(mime);
            if (json.length > MAX_WPS_PRESENTATION_JSON_LENGTH) {
                continue;
            }
            const payload = parseWPSPresentationClipboard(json, type);
            if (payload) {
                return payload;
            }
        } catch (e) {
            // 剪贴板可能拒绝读取自定义格式，继续尝试其他格式
        }
    }
};

export const shouldConvertWPSPresentation = (payload: IWPSPresentationClipboard | undefined,
                                              textHTML: string, siyuanHTML: string) => {
    return Boolean(payload && textHTML.trim() === "" && siyuanHTML.trim() === "");
};

export const getWPSPresentationFallback = (type: WPSPresentationClipboardType, hasFiles: boolean) => {
    return type === "objects" && hasFiles ? "files" : "plainText";
};
