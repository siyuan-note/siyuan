export interface IDockPanelVisibilityResolution {
    changed: boolean;
    storedVisible: boolean;
    visible: boolean;
}

export const resolveDockPanelVisibility = (storedVisible: boolean, hasActive: boolean,
                                            visible?: boolean): IDockPanelVisibilityResolution => {
    if (!hasActive) {
        return {
            changed: !storedVisible,
            storedVisible: true,
            visible: false,
        };
    }

    const nextVisible = typeof visible === "boolean" ? visible : !storedVisible;
    return {
        changed: nextVisible !== storedVisible,
        storedVisible: nextVisible,
        visible: nextVisible,
    };
};
