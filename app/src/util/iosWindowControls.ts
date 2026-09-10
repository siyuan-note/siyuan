// 原生容器提供窗口控件的额外占位，页面按当前视口比例换算为 CSS 像素。
const updateIOSWindowControls = () => {
    const root = document.documentElement;
    const value = root.getAttribute("data-ios-window-controls");
    if (!value) {
        return;
    }
    try {
        const [left, right, width, height = 0, top = 0, bottom = 0] = JSON.parse(value);
        if (![left, right, width, height, top, bottom].every(item => typeof item === "number" && Number.isFinite(item)) ||
            left < 0 || right < 0 || width <= 0 || height < 0 || top < 0 || bottom < 0) {
            return;
        }
        const scale = window.innerWidth / width;
        const properties: Record<string, number> = {
            "--ios-window-controls-left": left,
            "--ios-window-controls-right": right,
            "--ios-window-controls-height": height,
            "--ios-window-safe-top": top,
            "--ios-window-safe-bottom": bottom,
        };
        Object.keys(properties).forEach(name => {
            const pixels = `${properties[name] * scale}px`;
            if (root.style.getPropertyValue(name) !== pixels) {
                root.style.setProperty(name, pixels);
            }
        });
    } catch (error) {
        // 忽略无效的原生布局数据，保留上次有效位置。
    }
};

window.addEventListener("siyuan-ios-window-controls", updateIOSWindowControls);
window.addEventListener("resize", updateIOSWindowControls);
updateIOSWindowControls();
