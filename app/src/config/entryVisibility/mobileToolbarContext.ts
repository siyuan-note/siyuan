import {TOOLBAR_ENTRY_ROOT_PATH} from "../../protyle/toolbar/defaults";

export const MOBILE_TOOLBAR_CONTEXT_KEYS = ["mobile-input", "mobile-selection"];

export const getMobileToolbarContextPath = (hasText: boolean) =>
    `${TOOLBAR_ENTRY_ROOT_PATH}.${hasText ? "mobile-selection" : "mobile-input"}`;

export const isMobileToolbarContextPath = (path: string) =>
    MOBILE_TOOLBAR_CONTEXT_KEYS.some(key => path === `${TOOLBAR_ENTRY_ROOT_PATH}.${key}`);

export const getLegacyMobileToolbarEntryPath = (path: string) => {
    // 未选中文字时的引用入口采用新默认值，可在该上下文中单独启用。
    if (path === `${getMobileToolbarContextPath(false)}.block-ref`) {
        return;
    }
    const context = MOBILE_TOOLBAR_CONTEXT_KEYS.find(key => path.startsWith(`${TOOLBAR_ENTRY_ROOT_PATH}.${key}.`));
    return context ? `${TOOLBAR_ENTRY_ROOT_PATH}.${path.substring(`${TOOLBAR_ENTRY_ROOT_PATH}.${context}.`.length)}` :
        undefined;
};
