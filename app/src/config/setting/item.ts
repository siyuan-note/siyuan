import type {RowPart} from "../render/parts";
import type {SettingControl} from "./control";
import type {SettingGroup} from "./group";
import {getSettingGroupsByTabId} from "./group";
import {buildItemSearchIndex} from "../search/normalize";

type SettingItemBase = {
    id: string;
    tabId: string;
    groupId: string;
    /** 条目检索串（注册时 normalize） */
    searchIndex: readonly string[];
    readValue?: (el: HTMLElement) => unknown;
    save?: (value: unknown) => void | Promise<void>;
    afterMount?: (root: HTMLElement) => void | Promise<void>;
};

/** 标准控件行：由 rowParts 描述整行 UI，参与 mount、save、搜索 */
type FullSettingItem = SettingItemBase & {
    kind: "full";
    rowParts: RowPart[];
};

/** 自定义 HTML 块：参与 mount、搜索 */
type RenderSettingItem = SettingItemBase & {
    kind: "render";
    html: () => string;
    searchTexts?: () => string[];
};

/** 复合块内嵌控件：仅参与 readValue / save 路由 */
type BindingSettingItem = SettingItemBase & {
    kind: "binding";
    control: SettingControl;
};

type SettingItem = FullSettingItem | RenderSettingItem | BindingSettingItem;
export type MountableSettingItem = FullSettingItem | RenderSettingItem;
export type RegisterSettingItem =
    | Omit<FullSettingItem, "searchIndex">
    | Omit<RenderSettingItem, "searchIndex">
    | Omit<BindingSettingItem, "searchIndex">;

export type TabGroupEntry = {
    group: SettingGroup;
    items: MountableSettingItem[];
};

const settingItemsById = new Map<SettingItem["id"], SettingItem>();
const itemsByGroupCache = new Map<string, Map<string, MountableSettingItem[]>>();

const getMountableItemsByGroup = (tabId: string): Map<string, MountableSettingItem[]> => {
    let itemsByGroup = itemsByGroupCache.get(tabId);
    if (itemsByGroup) {
        return itemsByGroup;
    }
    itemsByGroup = new Map<string, MountableSettingItem[]>();
    for (const item of settingItemsById.values()) {
        if (item.kind !== "binding" && item.tabId === tabId) {
            const groupItems = itemsByGroup.get(item.groupId);
            if (groupItems) {
                groupItems.push(item);
            } else {
                itemsByGroup.set(item.groupId, [item]);
            }
        }
    }
    itemsByGroupCache.set(tabId, itemsByGroup);
    return itemsByGroup;
};

/** Tab 下按分组注册顺序的条目视图（渲染 / 搜索 / mount 共用） */
export const getTabGroupEntries = (tabId: string): TabGroupEntry[] => {
    const itemsByGroup = getMountableItemsByGroup(tabId);
    return getSettingGroupsByTabId(tabId).map((group) => ({
        group,
        items: itemsByGroup.get(group.id) ?? [],
    }));
};

export const registerSettingItem = (item: RegisterSettingItem) => {
    settingItemsById.set(item.id, {
        ...item,
        searchIndex: buildItemSearchIndex(item)
    } as SettingItem);
    if (item.kind !== "binding") {
        itemsByGroupCache.delete(item.tabId);
    }
};

export const getSettingItem = (id: string) => settingItemsById.get(id);

/** 从注册表移除 Tab 条目，供 rebuild 时重新 register 以读取最新 config */
export const removeSettingTabItems = (tabId: string) => {
    for (const [id, item] of settingItemsById) {
        if (item.tabId === tabId) {
            settingItemsById.delete(id);
        }
    }
    itemsByGroupCache.delete(tabId);
};
