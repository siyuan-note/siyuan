export type PluginDockEntryKey = `plugin:${string}:${string}`;

const encodeDockEntryKeyPart = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");

export const getPluginDockEntryKey = (pluginName: string, dockID: string): PluginDockEntryKey =>
    `plugin:${encodeDockEntryKeyPart(pluginName)}:${encodeDockEntryKeyPart(dockID)}`;

export const isPluginDockEntryKey = (value: unknown): value is PluginDockEntryKey =>
    typeof value === "string" && /^plugin:[^:]+:[^:]+$/.test(value);
