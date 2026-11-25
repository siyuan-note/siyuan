export const getMobileSheetHeight = (fullHeight: number, available: number, expanded: boolean) =>
    Math.max(0, expanded ? available : Math.min(available, fullHeight / 2));

export const getMobileSheetDragAction = (offset: number, duration: number, height: number, fromGrip: boolean) => {
    const distance = Math.abs(offset);
    const threshold = fromGrip ? 40 : Math.min(120, height * .25);
    if (distance < 4 || (distance < threshold && !(distance > 20 && distance / Math.max(1, duration) > .6))) return;
    if (offset > 0) return "close";
    if (fromGrip) return "expand";
};
