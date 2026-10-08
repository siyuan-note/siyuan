import {getDefaultToolbar, getToolbarEntryId, getToolbarEntryLabel, IToolbarCatalogEntry,
    markPluginToolbarEntries} from "./defaults";
import {toolbarKeyToMenu} from "./util";
import {resolvePluginToolbar} from "../../plugin/toolbarItem";

interface IToolbarCatalogPlugin {
    name: string;
    displayName?: string;
    updateProtyleToolbar(toolbar: Array<string | IMenuItem>): Array<string | IMenuItem>;
}

export const getEditorToolbarCatalogSnapshot = (plugins: IToolbarCatalogPlugin[]): IToolbarCatalogEntry[] => {
    let toolbar: Array<string | IMenuItem> = toolbarKeyToMenu(getDefaultToolbar(false));
    plugins.forEach((plugin) => {
        const previous = [...toolbar];
        toolbar = markPluginToolbarEntries(previous, resolvePluginToolbar(plugin, toolbar), plugin.name, (item) => {
            const pluginName = plugin.displayName?.trim() || plugin.name;
            const label = item.tip || (item.lang ? window.siyuan.languages[item.lang] : "") || item.name;
            return `${pluginName} - ${label}`;
        });
        toolbar = toolbarKeyToMenu(toolbar);
    });
    return toolbar.flatMap((item: IMenuItem) => {
        const key = getToolbarEntryId(item);
        return key ? [{key, label: getToolbarEntryLabel(item) || item.tip || item.name,
            separator: item.name === "|"}] : [];
    });
};
