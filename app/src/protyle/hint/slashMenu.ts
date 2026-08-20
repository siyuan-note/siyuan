import {reorderEntrySlots} from "../../config/entryVisibility/order";

export type TSlashMenuItem = IHintData & {
    entryKey: string;
};

interface IResolveSlashMenuOptions {
    enabled: boolean;
    hideConfiguredCreate: boolean;
    key: string;
    order: string[];
    visible: (entryKey: string) => boolean;
}

const isSeparator = (item?: TSlashMenuItem) => item?.html === "separator";

export const normalizeSlashMenuSeparators = (items: TSlashMenuItem[]) => {
    const result: TSlashMenuItem[] = [];
    items.forEach((item) => {
        if (isSeparator(item)) {
            if (result.length > 0 && !isSeparator(result[result.length - 1])) {
                result.push(item);
            }
            return;
        }
        result.push(item);
    });
    if (isSeparator(result[result.length - 1])) {
        result.pop();
    }
    return result;
};

export const resolveSlashMenuItems = (items: TSlashMenuItem[], options: IResolveSlashMenuOptions) => {
    if (!options.enabled) {
        return [];
    }
    const entryKeys = new Set<string>();
    const uniqueItems = items.filter((item) => {
        if (entryKeys.has(item.entryKey)) {
            return false;
        }
        entryKeys.add(item.entryKey);
        return true;
    });
    const orderedItems = reorderEntrySlots(uniqueItems, options.order, (item) => item.entryKey);
    const visibleItems = orderedItems.filter((item) => options.visible(item.entryKey) &&
        !(options.hideConfiguredCreate && item.entryKey === "newFileRef"));
    const filteredItems = options.key === "" ? visibleItems : visibleItems.filter((item) => item.filter?.some((filter) =>
        filter.toLowerCase().includes(options.key.toLowerCase())));
    return normalizeSlashMenuSeparators(filteredItems);
};
