import {computeDesktopAVMapGeometry, intersects, MapGeometry, MapRect} from "./desktopGeometry";
import {isMapUnplacedMenu} from "./unplacedMenu";

const readMenuRect = (element: HTMLElement, style: CSSStyleDeclaration, scope: Window): MapRect | undefined => {
    // 无法用单个矩形可靠界定的主题效果仍走全隐藏路径。
    const measurable = (value: CSSStyleDeclaration) => value.transform === "none" && value.filter === "none" &&
        ["", "normal", "1"].includes(value.getPropertyValue("zoom")) &&
        [value.translate, value.rotate, value.scale].every(item => !item || item === "none");
    if (!measurable(style)) return;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (!measurable(scope.getComputedStyle(parent))) return;
    }
    const rect = element.getBoundingClientRect();
    let left = 0, right = 0, top = 0, bottom = 0;
    const shadows = style.boxShadow === "none" ? [] : style.boxShadow.split(/,(?![^()]*\))/);
    for (const shadow of shadows) {
        const parts = shadow.replace(/(?:rgba?|hsla?)\([\d\s.,%/+\-]+\)/, "").trim().split(/\s+/);
        const inset = parts[0] === "inset" || parts[parts.length - 1] === "inset";
        if (inset) parts.splice(parts[0] === "inset" ? 0 : parts.length - 1, 1);
        if (parts.length < 2 || parts.length > 4 || parts.some(value => !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(value))) return;
        const [x, y, blur = 0, spread = 0] = parts.map(parseFloat);
        if (blur < 0) return;
        if (inset) continue;
        // 模糊阴影按两倍半径保守外扩，包含多层阴影、负偏移和边框外侧的描边。
        const extent = Math.max(0, blur * 2 + spread);
        left = Math.max(left, extent - x);
        right = Math.max(right, extent + x);
        top = Math.max(top, extent - y);
        bottom = Math.max(bottom, extent + y);
    }
    if (style.outlineStyle !== "none") {
        if (![style.outlineWidth, style.outlineOffset].every(value => /^-?(?:\d+\.?\d*|\.\d+)px$/.test(value))) return;
        const outline = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
        left = Math.max(left, outline);
        right = Math.max(right, outline);
        top = Math.max(top, outline);
        bottom = Math.max(bottom, outline);
    }
    return {x: rect.x - left, y: rect.y - top, width: rect.width + left + right, height: rect.height + top + bottom};
};

export const readDesktopAVMapGeometry = (container: HTMLElement): MapGeometry => {
    const doc = container.ownerDocument;
    const scope = doc.defaultView;
    if (!scope) {
        return {visible: false};
    }
    if (doc.hidden) {
        return {visible: false};
    }
    if (!container.isConnected) {
        return {visible: false};
    }
    if (!container.getClientRects().length) {
        return {visible: false};
    }
    const rect = container.getBoundingClientRect();
    const clips: MapRect[] = [{x: 0, y: 0, width: scope.innerWidth, height: scope.innerHeight}];
    for (let element: HTMLElement = container; element; element = element.parentElement) {
        const style = scope.getComputedStyle(element);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 ||
            style.getPropertyValue("content-visibility") === "hidden") {
            return {visible: false};
        }
        if (element !== container && /hidden|clip|scroll|auto/.test(style.overflowX + style.overflowY)) {
            const bounds = element.getBoundingClientRect();
            const clipX = /hidden|clip|scroll|auto/.test(style.overflowX);
            const clipY = /hidden|clip|scroll|auto/.test(style.overflowY);
            const scaleX = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
            const scaleY = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
            clips.push({x: clipX ? bounds.x + element.clientLeft * scaleX : 0,
                y: clipY ? bounds.y + element.clientTop * scaleY : 0,
                width: clipX ? element.clientWidth * scaleX : scope.innerWidth,
                height: clipY ? element.clientHeight * scaleY : scope.innerHeight});
        }
    }
    const views = container.closest(".av[data-type='NodeAttributeView']")
        ?.querySelector<HTMLElement>(":scope > .av__container > .av__header > .av__views--fixed");
    if (views?.getClientRects().length) {
        const style = scope.getComputedStyle(views);
        const bounds = views.getBoundingClientRect();
        if (["fixed", "sticky"].includes(style.position) && style.display !== "none" &&
            style.visibility === "visible" && Number(style.opacity) !== 0 && intersects(rect, bounds)) {
            // 本数据库的固定页签栏遮住地图顶部时，只展示栏底部以下的区域。
            const top = Math.max(0, bounds.y + bounds.height);
            clips.push({x: 0, y: top, width: scope.innerWidth, height: Math.max(0, scope.innerHeight - top)});
        }
    }
    const occluders: MapRect[] = [];
    const menus: MapRect[] = [];
    let unsupportedMenu = false;
    // 只检查应用实际浮层根节点，不根据任意 z-index 猜测遮挡。
    doc.querySelectorAll<HTMLElement>(".b3-menu, .b3-dialog, .av__panel, .protyle-util, .protyle-toolbar, .block__popover, [popover]")
        .forEach((element) => {
            if (element.contains(container) || !element.getClientRects().length) {
                return;
            }
            const style = scope.getComputedStyle(element);
            if (style.display !== "none" && style.visibility === "visible" && Number(style.opacity) !== 0) {
                if (isMapUnplacedMenu(element, container)) {
                    const bounds = readMenuRect(element, style, scope);
                    const hasSubmenu = Array.from(element.querySelectorAll<HTMLElement>(".b3-menu__submenu"))
                        .some(submenu => {
                            const submenuStyle = scope.getComputedStyle(submenu);
                            return submenu.getClientRects().length && submenuStyle.display !== "none" &&
                                submenuStyle.visibility === "visible" && Number(submenuStyle.opacity) !== 0;
                        });
                    if (!bounds || hasSubmenu) unsupportedMenu = true;
                    else menus.push(bounds);
                } else {
                    occluders.push(element.getBoundingClientRect());
                }
            }
        });
    if (unsupportedMenu) return {visible: false};
    const geometry = computeDesktopAVMapGeometry(rect, clips, occluders, menus);
    if (geometry.visible) {
        const bounds = geometry.bounds;
        // 在主文档中命中检测，包括固定工具栏；原生子视图不属于此 DOM 树。
        for (const x of [bounds.x + 0.5, bounds.x + bounds.width / 2, bounds.x + bounds.width - 0.5]) {
            for (const y of [bounds.y + 0.5, bounds.y + bounds.height / 2, bounds.y + bounds.height - 0.5]) {
                const top = doc.elementFromPoint(x, y);
                if (!top || !container.contains(top)) {
                    return {visible: false};
                }
            }
        }
    }
    return geometry;
};
