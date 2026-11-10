export const getMobileSheetBounds = (natural: number, chrome: number, available: number) => ({
    min: Math.max(0, Math.min(natural, chrome + 120, available)),
    max: Math.max(0, available),
});

export type SheetGesture = {
    height: number, min: number, max: number, offset: number, time: number,
    phaseStart?: number,
};

export const moveSheetGesture = (state: SheetGesture, offset: number, time: number) => {
    const requested = state.height - offset;
    const excess = Math.max(0, state.min - requested);
    const boundary = state.height - state.min;
    if (!excess) {
        state.phaseStart = undefined;
    } else if (state.phaseStart === undefined) {
        const distance = offset - state.offset;
        const fraction = distance > 0 ? Math.max(0, Math.min(1, (boundary - state.offset) / distance)) : 1;
        state.phaseStart = state.time + (time - state.time) * fraction;
    }
    state.offset = offset;
    state.time = time;
    const speed = state.phaseStart === undefined || time <= state.phaseStart ? 0 : excess / (time - state.phaseStart);
    return {
        height: Math.max(state.min, Math.min(state.max, requested)), excess,
        close: excess > Math.min(120, state.min * .25) || (excess > 20 && speed > .6),
    };
};
