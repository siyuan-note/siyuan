const ownerKey = Symbol.for("siyuan.colorPicker.owner");
interface IColorOwner {
    plugin: object;
    active: boolean;
    sessions: Set<() => void>;
}

export const registerColorPickerOwner = (plugin: object) => {
    Object.defineProperty(plugin, ownerKey, {value: {plugin, active: true, sessions: new Set()} satisfies IColorOwner});
};

export const getColorPickerOwner = (plugin: object): IColorOwner => {
    const state = plugin?.[ownerKey as keyof typeof plugin] as unknown as IColorOwner;
    if (!state?.active || state.plugin !== plugin) { throw new TypeError("Color picker requires a live Plugin instance"); }
    return state;
};

export const cancelPluginColorPickers = (plugin: object) => {
    const state = plugin?.[ownerKey as keyof typeof plugin] as unknown as IColorOwner;
    if (!state || state.plugin !== plugin) { return; }
    state.active = false;
    const sessions = Array.from(state.sessions);
    state.sessions.clear();
    sessions.forEach(cancel => {
        try { cancel(); } catch (error) { console.error("Could not cancel plugin color picker", error); }
    });
};
