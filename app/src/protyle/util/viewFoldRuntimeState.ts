export interface IViewFoldRuntimeState {
    defaults?: Map<string, boolean>,
    transient?: Map<string, boolean>,
}

export interface IViewFoldOccurrenceIdentity {
    pane: string,
    rootID: string,
    occurrenceID: string,
}

const getOccurrencePrefix = (identity: IViewFoldOccurrenceIdentity) => [
    "fold",
    encodeURIComponent(identity.pane || ""),
    encodeURIComponent(identity.rootID || ""),
    encodeURIComponent(identity.occurrenceID || ""),
    "",
].join(":");

const clearEntries = (states: Map<string, boolean> | undefined, prefix: string) => {
    states?.forEach((_value, key) => {
        if (key.startsWith(prefix)) {
            states.delete(key);
        }
    });
};

export const clearViewFoldDefaultsForOccurrence = (
    state: IViewFoldRuntimeState,
    identity: IViewFoldOccurrenceIdentity,
) => {
    clearEntries(state.defaults, getOccurrencePrefix(identity));
};

export const clearViewFoldOccurrenceRuntimeState = (
    state: IViewFoldRuntimeState,
    identity: IViewFoldOccurrenceIdentity,
) => {
    const prefix = getOccurrencePrefix(identity);
    clearEntries(state.defaults, prefix);
    clearEntries(state.transient, prefix);
};
