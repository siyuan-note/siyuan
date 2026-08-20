import {reorderEntrySlots} from "../../config/entryVisibility/order";

interface IResolveToolbarItemsOptions<T> {
    getKey: (item: T) => string | undefined;
    isSeparator: (item: T) => boolean;
    isVisible: (key: string) => boolean;
    order: string[];
}

export const normalizeToolbarSeparators = <T>(items: T[], isSeparator: (item: T) => boolean) => {
    const result: T[] = [];
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

export const resolveToolbarItems = <T>(items: T[], options: IResolveToolbarItemsOptions<T>) => {
    const ordered = reorderEntrySlots(items, options.order, options.getKey);
    const configured = ordered.filter((item) => {
        const key = options.getKey(item);
        return !key || options.isVisible(key);
    });
    return {
        ordered,
        visible: normalizeToolbarSeparators(configured, options.isSeparator),
    };
};
