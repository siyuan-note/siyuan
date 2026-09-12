import {
    getEntryCatalogChildren,
    getEntryCatalogNode,
    isEntryCatalogNodeConfigurable,
    IEntryCatalogNode,
} from "./catalog";

export interface IEntryVisibilityMenuRuntime {
    getEntryOrder: (parentPath: string) => string[];
    isEntryVisible: (path: string) => boolean;
    setEntryVisibilityValue: (path: string, visible: boolean) => void;
    getEntryIcon: (path: string) => Pick<IMenu, "icon" | "iconHTML">;
    readonly: boolean;
    languages: { [key: string]: any };
}

const getConfigurableEntries = (parentPath: string, runtime: IEntryVisibilityMenuRuntime): IEntryCatalogNode[] => {
    const nodes = getEntryCatalogChildren(parentPath) || [];
    const nodeByKey = new Map(nodes.map((item) => [item.key, item]));
    return runtime.getEntryOrder(parentPath)
        .map((key) => nodeByKey.get(key))
        .filter((item): item is IEntryCatalogNode =>
            Boolean(item && item.type === "entry" && isEntryCatalogNodeConfigurable(item)));
};

export const buildEntryVisibilityMenuItems = (parentPath: string, runtime: IEntryVisibilityMenuRuntime,
                                                filter?: (key: string) => boolean): IMenu[] => {
    return getConfigurableEntries(parentPath, runtime)
        .filter((item) => !filter || filter(item.key))
        .map((item) => {
            const path = `${parentPath}.${item.key}`;
            const visible = runtime.isEntryVisible(path);
            return {
                id: path,
                ...runtime.getEntryIcon(path),
                label: item.label(),
                checked: visible,
                disabled: runtime.readonly,
                click: () => {
                    runtime.setEntryVisibilityValue(path, !visible);
                },
            };
        });
};

export const buildEntryVisibilityToggleItem = (path: string, runtime: IEntryVisibilityMenuRuntime): IMenu | undefined => {
    const node = getEntryCatalogNode(path);
    if (!node || !isEntryCatalogNodeConfigurable(node)) {
        return undefined;
    }
    const visible = runtime.isEntryVisible(path);
    return {
        id: `${path}.toggle`,
        label: (visible ? runtime.languages.entryHide : runtime.languages.entryShow).replace("${name}", () => node.label()),
        icon: visible ? "iconEyeoff" : "iconEye",
        disabled: runtime.readonly,
        click: () => {
            runtime.setEntryVisibilityValue(path, !visible);
        },
    };
};
