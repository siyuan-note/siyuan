import type {Menu} from "../../../plugin/Menu";
import {isMobile} from "../../../util/functions";

// 视图设置的子菜单贴近设置项侧边展开，边框略微重叠以缩短鼠标移动距离。
export const openViewSettingMenu = (menu: Menu, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    if (isMobile()) {
        menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        return;
    }
    const position = {x: rect.right - 4, y: rect.top - 8};
    menu.open(position);
    const width = menu.element.getBoundingClientRect().width;
    if (position.x + width > window.innerWidth) {
        position.x = rect.left - width + 4;
    }
    position.x = Math.max(0, Math.min(position.x, window.innerWidth - width));
    // 同步保存的坐标，菜单重新定位时继续使用同一展开方向。
    menu.element.style.left = position.x + "px";
};
