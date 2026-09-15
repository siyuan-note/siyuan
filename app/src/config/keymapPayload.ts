import type {JSONValue} from "../types/api";

// 保留快捷键扩展字段，并将声明式配置转换为接口允许的 JSON 对象。
export const keymapPayload = (keymap: Config.IKeymap): {[key: string]: JSONValue} => {
    const keys = (items: Config.IKeys): {[key: string]: JSONValue} => {
        const result: {[key: string]: JSONValue} = {};
        for (const [name, item] of Object.entries(items)) {
            if (item == null) {
                result[name] = item === null ? null : undefined;
            } else {
                result[name] = {...item};
            }
        }
        return result;
    };
    const plugin: {[key: string]: JSONValue} = {};
    for (const [name, items] of Object.entries(keymap.plugin || {})) {
        if (items == null) {
            plugin[name] = items === null ? null : undefined;
        } else {
            plugin[name] = keys(items);
        }
    }
    return {
        ...keymap,
        editor: {
            ...keymap.editor,
            general: keys(keymap.editor.general),
            heading: keys(keymap.editor.heading),
            insert: keys(keymap.editor.insert),
            list: keys(keymap.editor.list),
            table: keys(keymap.editor.table),
        },
        general: keys(keymap.general),
        plugin,
    };
};
