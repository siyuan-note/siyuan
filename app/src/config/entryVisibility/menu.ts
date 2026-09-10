import {buildEntryVisibilityMenuItems as buildMenuItems,
    buildEntryVisibilityToggleItem as buildToggleItem,
    IEntryVisibilityMenuRuntime,
} from "./menuItems";
import {getEntryOrder, isEntryVisible, setEntryVisibilityValue} from "./runtime";

const getRuntime = (): IEntryVisibilityMenuRuntime => ({
    getEntryOrder,
    isEntryVisible,
    setEntryVisibilityValue,
    readonly: window.siyuan.config.readonly,
    languages: window.siyuan.languages,
});

export const buildEntryVisibilityMenuItems = (parentPath: string) =>
    buildMenuItems(parentPath, getRuntime());

export const buildEntryVisibilityToggleItem = (path: string) =>
    buildToggleItem(path, getRuntime());
