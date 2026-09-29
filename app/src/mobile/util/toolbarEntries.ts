import {getToolbarEntryId, MOBILE_TOOLBAR_NAMES} from "../../protyle/toolbar/defaults";
import {resolveToolbarItems} from "../../protyle/toolbar/entryVisibility";
import {getMobileToolbarActionKey, MOBILE_TOOLBAR_ACTION_NAMES} from "./toolbarActions";
export const applyMobileToolbarEntries = (element: HTMLElement, toolbar: Array<string | IMenuItem>, options: {
    order: string[];
    isVisible: (key: string) => boolean;
    isAvailable?: (name: string) => boolean;
}) => {
    const items = new Map(toolbar.filter((item): item is IMenuItem => typeof item !== "string")
        .map(item => [item.name, item]));
    const available = new Set(toolbar.map(item => typeof item === "string" ? item : item.name));
    const children = Array.from(element.children) as HTMLElement[];
    children.forEach(child => {
        const item = items.get(child.dataset.type);
        const key = MOBILE_TOOLBAR_ACTION_NAMES.includes(child.dataset.type) ? getMobileToolbarActionKey(child.dataset.type) :
            item ? getToolbarEntryId(item) : MOBILE_TOOLBAR_NAMES.includes(child.dataset.type) ? child.dataset.type : undefined;
        if (key) {
            child.dataset.id = key;
        }
    });
    const result = resolveToolbarItems(children, {
        getKey: item => item.dataset.id,
        isSeparator: item => item.classList.contains("keyboard__split"),
        isVisible: key => options.isVisible(key) && children.some(item => item.dataset.id === key &&
            (item.classList.contains("keyboard__split") ||
                (MOBILE_TOOLBAR_ACTION_NAMES.includes(item.dataset.type) || available.has(item.dataset.type)) &&
                options.isAvailable?.(item.dataset.type) !== false)),
        order: options.order,
    });
    const visible = new Set(result.visible);
    result.ordered.forEach(item => {
        element.append(item);
        item.classList.toggle("fn__none", !visible.has(item));
    });
};
