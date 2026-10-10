export interface MapRect { x: number; y: number; width: number; height: number; }
export type MapGeometry = {visible: false} | {
    visible: true; bounds: MapRect; logicalSize: {width: number; height: number}; crop: {x: number; y: number};
};

export const intersects = (a: MapRect, b: MapRect) => a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;

// 菜单打开时不展示难以操作的狭窄残片。
const MIN_MENU_MAP_EDGE = 32;
const MIN_MENU_MAP_AREA = 4096;

// 坐标始终使用主文档 CSS 像素，只由主进程应用文档缩放系数。
export const computeDesktopAVMapGeometry = (rect: MapRect, clips: MapRect[], occluders: MapRect[] = [],
                                          menus: MapRect[] = []): MapGeometry => {
    if (![rect, ...clips, ...occluders, ...menus].every((item) => [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
        item.width >= 0 && item.height >= 0)) {
        return {visible: false};
    }
    if (rect.width < 1 || rect.height < 1) {
        return {visible: false};
    }
    let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
    clips.forEach((clip) => {
        left = Math.max(left, clip.x);
        top = Math.max(top, clip.y);
        right = Math.min(right, clip.x + clip.width);
        bottom = Math.min(bottom, clip.y + clip.height);
    });
    // 裁剪边缘内收一个 CSS 像素，避免半像素命中相邻控件；原生绘制区域与命中检测同步收窄。
    if (left > rect.x) left += 1;
    if (top > rect.y) top += 1;
    if (right < rect.x + rect.width) right -= 1;
    if (bottom < rect.y + rect.height) bottom -= 1;
    // 裁剪差值的浮点舍入不能使可见尺寸超过原始尺寸。
    let bounds = {x: left, y: top, width: Math.min(rect.width, right - left), height: Math.min(rect.height, bottom - top)};
    if (left < 0 || top < 0 || bounds.width < 1 || bounds.height < 1) {
        return {visible: false};
    }
    if (occluders.some((item) => item.width > 0 && item.height > 0 && intersects(bounds, item))) {
        return {visible: false};
    }
    const overlapping = menus.filter(item => item.width > 0 && item.height > 0 && intersects(bounds, item));
    if (overlapping.length > 1) return {visible: false};
    if (overlapping.length) {
        const menu = overlapping[0];
        const rightEdge = bounds.x + bounds.width, bottomEdge = bounds.y + bounds.height;
        // 只处理当前地图唯一的未定位菜单，在四个连续矩形中选择面积最大的安全区域。
        const candidates = [
            [bounds.x, bounds.y, Math.min(rightEdge, menu.x - 1), bottomEdge],
            [Math.max(bounds.x, menu.x + menu.width + 1), bounds.y, rightEdge, bottomEdge],
            [bounds.x, bounds.y, rightEdge, Math.min(bottomEdge, menu.y - 1)],
            [bounds.x, Math.max(bounds.y, menu.y + menu.height + 1), rightEdge, bottomEdge],
        ].map(([x, y, right, bottom]) => ({x: Math.ceil(x), y: Math.ceil(y),
            width: Math.floor(right) - Math.ceil(x), height: Math.floor(bottom) - Math.ceil(y)}))
            .filter(item => item.width >= MIN_MENU_MAP_EDGE && item.height >= MIN_MENU_MAP_EDGE &&
                item.width * item.height >= MIN_MENU_MAP_AREA);
        if (!candidates.length) return {visible: false};
        bounds = candidates.reduce((largest, item) => item.width * item.height > largest.width * largest.height ? item : largest);
    }
    return {visible: true, bounds, logicalSize: {width: rect.width, height: rect.height},
        crop: {x: bounds.x - rect.x, y: bounds.y - rect.y}};
};
