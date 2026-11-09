import type {App} from "../index";
import type {Tab} from "../layout/Tab";
import type {Plugin} from "./index";

const owners = new WeakMap<Tab, string>();
const uninstalledTabs = new WeakSet<Tab>();
const pluginNames = new WeakMap<App, Set<string>>();
const unavailableCatalogs = new WeakSet<App>();

export const setCustomTabCatalogAvailable = (app: App, available: boolean) => {
    if (available) { unavailableCatalogs.delete(app); }
    else { unavailableCatalogs.add(app); }
};

export const rememberCustomTabPlugins = (app: App, names: Iterable<string>) => {
    const known = pluginNames.get(app) || new Set<string>();
    for (const name of names) { known.add(name); }
    pluginNames.set(app, known);
};

export const setCustomTabOwner = (tab: Tab, name: string) => owners.set(tab, name);
export const getCustomTabOwner = (tab: Tab) => owners.get(tab);
export const markCustomTabUninstalled = (tab: Tab) => uninstalledTabs.add(tab);
export const isCustomTabUninstalled = (tab: Tab) => uninstalledTabs.has(tab);

export const resolveCustomTabOwner = (app: App, type: string, tab?: Tab): string | undefined => {
    if (type === "siyuan-card" || type === "siyuan-database-row") { return; }
    const owner = tab && owners.get(tab);
    if (owner) { return owner; }
    if (!type || unavailableCatalogs.has(app)) { return; }
    const names = new Set([...pluginNames.get(app) || [], ...app.plugins.map(plugin => plugin.name)]);
    const candidates = Array.from(names).filter(name => type.startsWith(name) && type.length > name.length);
    // 旧键未记录插件名与类型的分界，多个前缀匹配时不能将数据交给任一插件。
    if (candidates.length > 1) { return; }
    const registered = app.plugins.filter(plugin => Object.hasOwn(plugin.models, type));
    if (registered.length > 1 || (candidates.length && registered.some(plugin => plugin.name !== candidates[0]))) {
        return;
    }
    return candidates[0] || registered[0]?.name;
};

export const resolveCustomModelFactory = (app: App, type: string, tab?: Tab): Plugin["models"][string] | undefined => {
    const owner = resolveCustomTabOwner(app, type, tab);
    const plugin = app.plugins.find(item => item.name === owner);
    return plugin && Object.hasOwn(plugin.models, type) ? plugin.models[type] : undefined;
};
