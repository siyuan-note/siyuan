import type {SystemAppConf} from "../types/api";

const isObject = (value: unknown): value is {[key: string]: unknown} =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const optionalString = (value: unknown) => value == null || typeof value === "string";
const optionalBoolean = (value: unknown) => value == null || typeof value === "boolean";
const optionalNumber = (value: unknown) => value == null || typeof value === "number";
const stringArray = (value: unknown) => value == null || Array.isArray(value) && value.every(item => typeof item === "string");

const isKey = (value: unknown): boolean => {
    if (value == null) {
        return true;
    }
    if (!isObject(value) || !optionalString(value.custom) || !optionalString(value.default)) {
        return false;
    }
    const bindings = value.bindings;
    return bindings == null || isObject(bindings) &&
        (bindings.priority == null || isObject(bindings.priority) && Object.values(bindings.priority).every(optionalNumber));
};

const isKeys = (value: unknown): boolean => value == null || isObject(value) && Object.values(value).every(isKey);

const repairFalsyKeymapGroups = (value: {[key: string]: unknown}) => {
    const keys = (group: unknown): unknown => {
        if (!group) {
            return group == null ? group : undefined;
        }
        if (!isObject(group)) {
            return group;
        }
        const result: {[key: string]: unknown} = {...group};
        for (const [name, item] of Object.entries(group)) {
            if (!item && item != null) {
                result[name] = undefined;
            } else if (item != null && !isObject(item)) {
                // 保留键名交给后续默认值合并及废弃键清理，标量不提供快捷键字段。
                result[name] = Object.assign({}, item);
            }
        }
        return result;
    };
    const editor = value.editor;
    const plugin = value.plugin;
    const plugins: {[key: string]: unknown} = {};
    if (isObject(plugin)) {
        for (const [name, group] of Object.entries(plugin)) {
            plugins[name] = keys(group);
        }
    }
    return {
        ...value,
        general: keys(value.general),
        editor: !editor ? editor || undefined : isObject(editor) ? {
            ...editor,
            general: keys(editor.general),
            heading: keys(editor.heading),
            insert: keys(editor.insert),
            list: keys(editor.list),
            table: keys(editor.table),
        } : editor,
        plugin: isObject(plugin) ? plugins : plugin,
    };
};

// 只核对前端会读取的快捷键字段，保留缺省分组、扩展字段与后续默认配置修复的时序。
const isKeymap = (value: unknown): value is Config.IKeymap => {
    if (value == null) {
        return true;
    }
    if (!isObject(value)) {
        return false;
    }
    const editor = value.editor;
    return isKeys(value.general) && (editor == null || isObject(editor) &&
        ["general", "heading", "insert", "list", "table"].every(key => isKeys(editor[key]))) &&
        (value.plugin == null || isObject(value.plugin) && Object.values(value.plugin).every(isKeys));
};

const isDock = (value: unknown): boolean => {
    if (value == null) {
        return true;
    }
    if (!isObject(value) || !optionalBoolean(value.pin) || !Array.isArray(value.data)) {
        return false;
    }
    return value.data.every(group => Array.isArray(group) && group.every(item => {
        if (!isObject(item) || !optionalString(item.hotkeyLangId) || !optionalString(item.icon) ||
            !optionalString(item.title) || !optionalString(item.type) || !optionalBoolean(item.show)) {
            return false;
        }
        return item.size == null || isObject(item.size) && optionalNumber(item.size.height) && optionalNumber(item.size.width);
    }));
};

const isUILayout = (value: unknown): value is Config.IUiLayout => {
    return value == null || isObject(value) && optionalBoolean(value.hideDock) &&
        [value.left, value.right, value.bottom].every(isDock) && isLayoutItem(value.layout);
};

const isSearchConfig = (value: unknown): boolean => {
    if (value == null) {
        return true;
    }
    if (!isObject(value)) {
        return false;
    }
    if (!["query", "hPath", "k", "name", "r"].every(key => optionalString(value[key])) ||
        !["group", "method", "page", "sort"].every(key => optionalNumber(value[key])) ||
        !["hasReplace", "removed", "sensitive"].every(key => optionalBoolean(value[key])) || !stringArray(value.idPath)) {
        return false;
    }
    const flags = (group: unknown) => group == null || isObject(group) && Object.values(group).every(optionalBoolean);
    const subTypes = value.subTypes;
    // 只核对参与筛选的已知分组，未知顶层键保留但不参与筛选。
    return flags(value.types) && flags(value.replaceTypes) && (subTypes == null || isObject(subTypes) &&
        ["heading", "list", "listItem"].every(key => flags(subTypes[key])));
};

const isLayoutItem = (value: unknown): boolean => {
    if (value == null) {
        return true;
    }
    if (!isObject(value)) {
        return false;
    }
    if (!["size", "width", "height", "title", "lang", "icon", "docIcon", "activeTime", "blockId", "rootId", "notebookId", "path", "customModelType"].every(key => optionalString(value[key])) ||
        !["active", "pin", "isPreview"].every(key => optionalBoolean(value[key])) || !optionalNumber(value.page)) {
        return false;
    }
    if (value.children != null && !(Array.isArray(value.children) ? value.children.every(isLayoutItem) : isLayoutItem(value.children))) {
        return false;
    }
    if (value.instance === "Layout" || value.instance == null) {
        return (value.direction == null || value.direction === "tb" || value.direction === "lr") &&
            (value.resize == null || value.resize === "tb" || value.resize === "lr") &&
            (value.type == null || typeof value.type === "string" && ["normal", "center", "top", "bottom", "left", "right"].includes(value.type));
    }
    if (value.instance === "Wnd") {
        return value.resize == null || value.resize === "tb" || value.resize === "lr";
    }
    if (value.instance === "Backlink" || value.instance === "Outline") {
        return value.type == null || value.type === "pin" || value.type === "local";
    }
    if (value.instance === "Graph") {
        return value.type == null || value.type === "pin" || value.type === "local" || value.type === "global";
    }
    if (value.instance === "Search") {
        return isSearchConfig(value.config);
    }
    return typeof value.instance === "string" && ["Tab", "Editor", "Asset", "Custom", "Bookmark", "Files", "Tag"].includes(value.instance);
};

export const systemConfigCollections = (value: Pick<SystemAppConf, "keymap" | "uiLayout">,
                                       defaultLayout?: () => Config.IUiLayout): Pick<Config.IConf, "keymap" | "uiLayout"> => {
    const keymap = isObject(value.keymap) ? repairFalsyKeymapGroups(value.keymap) : value.keymap;
    if (!isKeymap(keymap)) {
        throw new Error("Invalid shortcut configuration");
    }
    const uiLayout = defaultLayout && (!isObject(value.uiLayout) || !value.uiLayout.left) ? defaultLayout() : value.uiLayout;
    if (!isUILayout(uiLayout)) {
        throw new Error("Invalid dock configuration");
    }
    return {keymap, uiLayout};
};

export const systemConfig = (value: SystemAppConf, defaultLayout?: () => Config.IUiLayout): Config.IConf =>
    ({...value, ...systemConfigCollections(value, defaultLayout)});
