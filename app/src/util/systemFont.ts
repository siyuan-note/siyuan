import {fetchSyncPost} from "./fetch";
import type {IFontItem} from "./systemFontCore";
import {parseSystemFontsJSON} from "./systemFontCore";

export {getFontFamilyDisplayName, getUniqueFontFamilies} from "./systemFontCore";
export type {IFontItem} from "./systemFontCore";

let systemFontsRequest: Promise<IFontItem[]> | undefined;

const requestSystemFonts = async () => {
    if (window.siyuan.config.system.container === "harmony" && window.JSHarmony?.getSystemFonts) {
        try {
            const fonts = parseSystemFontsJSON(await window.JSHarmony.getSystemFonts());
            if (fonts.length > 0) {
                return fonts;
            }
        } catch (error) {
            console.warn("load HarmonyOS system fonts failed", error);
        }
    }
    const response = await fetchSyncPost("/api/system/getSysFonts");
    return Array.isArray(response.data) ? response.data as IFontItem[] : [];
};

export const loadSystemFonts = async () => {
    if (!systemFontsRequest) {
        systemFontsRequest = requestSystemFonts().then(fonts => {
            // 鸿蒙字体可由系统动态安装，仅合并并发请求，后续打开列表时重新枚举。
            if (window.siyuan.config.system.container === "harmony" || fonts.length === 0) {
                systemFontsRequest = undefined;
            }
            return fonts;
        }).catch(error => {
            systemFontsRequest = undefined;
            throw error;
        });
    }
    return systemFontsRequest;
};
