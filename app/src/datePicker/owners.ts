const ownerKey = Symbol.for("siyuan.datePicker.owner");
interface IDateOwner {
    plugin: object;
    active: boolean;
    sessions: Set<() => void>;
}
export const registerDatePickerOwner = (plugin: object) => {
    Object.defineProperty(plugin, ownerKey, {value: {plugin, active: true, sessions: new Set()} satisfies IDateOwner});
};
export const getDatePickerOwner = (plugin: object): IDateOwner => {
    const state = plugin?.[ownerKey as keyof typeof plugin] as unknown as IDateOwner;
    if (!state?.active || state.plugin !== plugin) { throw new TypeError("Date picker requires a live Plugin instance"); }
    return state;
};
export const cancelPluginDatePickers = (plugin: object) => {
    const state = plugin?.[ownerKey as keyof typeof plugin] as unknown as IDateOwner;
    if (!state || state.plugin !== plugin) { return; }
    state.active = false;
    const sessions = Array.from(state.sessions);
    state.sessions.clear();
    sessions.forEach(cancel => {
        try { cancel(); } catch (error) { console.error("Could not cancel plugin date picker", error); }
    });
};
