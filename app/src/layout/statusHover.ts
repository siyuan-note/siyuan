export const syncStatusBarVisibility = () => {
    const element = document.getElementById("status");
    if (!element) return;
    const appearance = window.siyuan.config.appearance;
    const floating = appearance.hideStatusBar && appearance.showFloatingStatusBar === true;
    element.classList.toggle("fn__none", appearance.hideStatusBar && !floating);
    element.classList.toggle("status--floating", floating);
    element.classList.remove("status--floating-open");
};

export const updateStatusBarHover = (x: number, y: number, buttons: number) => {
    const element = document.getElementById("status");
    if (!element?.classList.contains("status--floating") || buttons !== 0) return;
    const rect = element.getBoundingClientRect();
    const corner = x >= window.innerWidth - 32 && y >= window.innerHeight - 8;
    const inside = element.classList.contains("status--floating-open") &&
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    element.classList.toggle("status--floating-open", corner || inside);
};
