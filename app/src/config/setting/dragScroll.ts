export const scrollSettingContent = (element: HTMLElement, event: WheelEvent) => {
    // 缩放手势继续交给浏览器或宿主处理。
    if (event.ctrlKey || event.metaKey) {
        return;
    }
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;
    if (event.shiftKey && deltaX === 0) {
        deltaX = deltaY;
        deltaY = 0;
    }
    if (event.deltaMode === 1) {
        const style = getComputedStyle(element);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
        deltaX *= lineHeight;
        deltaY *= lineHeight;
    } else if (event.deltaMode === 2) {
        deltaX *= element.clientWidth;
        deltaY *= element.clientHeight;
    }
    event.preventDefault();
    event.stopPropagation();
    // 直接更新位置，保留触控板连续滚动，并阻止边界处滚动穿透到背景编辑器。
    element.scrollLeft += deltaX;
    element.scrollTop += deltaY;
};
