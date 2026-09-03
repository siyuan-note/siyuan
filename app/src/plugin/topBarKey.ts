export type PluginTopBarEntryKey = `plugin:${string}:${string}`;

const encodeTopBarEntryKeyPart = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");

export const getPluginTopBarEntryKey = (pluginName: string, topBarID: string): PluginTopBarEntryKey =>
    `plugin:${encodeTopBarEntryKeyPart(pluginName)}:${encodeTopBarEntryKeyPart(topBarID)}`;

export const getLegacyPluginTopBarEntryKey = (pluginName: string, index: number): PluginTopBarEntryKey =>
    getPluginTopBarEntryKey(pluginName, `legacy-index:${index}`);

export const isPluginTopBarEntryKey = (value: unknown): value is PluginTopBarEntryKey =>
    typeof value === "string" && /^plugin:[^:]+:[^:]+$/.test(value);
