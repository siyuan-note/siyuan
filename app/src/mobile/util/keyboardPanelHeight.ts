// 键盘与菜单交接期间固定工具栏上沿，剩余空间随可见视口变化。
export const getKeyboardPanelHeight = (viewportBottom: number, panelTop: number, barHeight: number, bottomOffset = 0) =>
    Math.max(barHeight, viewportBottom - bottomOffset - panelTop);
