const getDockPanel = (position: TDockPosition) => {
    const layout = window.siyuan?.layout;
    if (!layout) {
        return undefined;
    }
    if (position === "Left") {
        return layout.leftDock;
    }
    if (position === "Right") {
        return layout.rightDock;
    }
    return layout.bottomDock;
};

export const toggleDockPanel = (position: TDockPosition, visible?: boolean) => {
    return getDockPanel(position)?.togglePanel(visible) ?? false;
};

export const isDockPanelVisible = (position: TDockPosition) => {
    return getDockPanel(position)?.isPanelVisible() ?? false;
};
