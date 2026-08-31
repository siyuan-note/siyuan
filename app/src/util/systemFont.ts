import {fetchSyncPost} from "./fetch";
import type {IFontItem} from "./systemFontCore";

export {getUniqueFontFamilies} from "./systemFontCore";
export type {IFontItem} from "./systemFontCore";

let systemFontsRequest: Promise<IFontItem[]> | undefined;

export const loadSystemFonts = async () => {
    if (!systemFontsRequest) {
        systemFontsRequest = fetchSyncPost("/api/system/getSysFonts").then(response =>
            Array.isArray(response.data) ? response.data as IFontItem[] : []
        ).catch(error => {
            systemFontsRequest = undefined;
            throw error;
        });
    }
    return systemFontsRequest;
};
