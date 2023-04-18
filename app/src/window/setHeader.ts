import {isWindow} from "../util/functions";
import {Wnd} from "../layout/Wnd";
import {getCurrentWindow} from "@electron/remote";
import {Layout} from "../layout";

const getAllWnds = (layout: Layout, wnds: Wnd[]) => {
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Wnd) {
            wnds.push(item);
        } else if (item instanceof Layout) {
            getAllWnds(item, wnds);
        }
    }
};

export const setTabPosition = () => {
    if (!isWindow()) {
        return;
    }
    const wndsTemp: Wnd[] = [];
    getAllWnds(window.siyuan.layout.layout, wndsTemp);
    wndsTemp.forEach(item => {
        const headerElement = item.headersElement.parentElement;
        const rect = headerElement.getBoundingClientRect();
        const dragElement = headerElement.querySelector(".item--readonly .fn__flex-1") as HTMLElement;
        if (rect.top <= 0) {
            dragElement.style.height = dragElement.parentElement.clientHeight + "px";
            // @ts-ignore
            dragElement.style.WebkitAppRegion = "drag";
        } else {
            // @ts-ignore
            dragElement.style.WebkitAppRegion = "";
        }
        const headersLastElement = headerElement.lastElementChild as HTMLElement;
        if ("darwin" === window.siyuan.config.system.os) {
            if (rect.top <= 0 && rect.left <= 0 && !getCurrentWindow().isFullScreen()) {
                item.headersElement.style.marginLeft = "var(--b3-toolbar-left-mac)";
                headersLastElement.style.paddingRight = "42px";
            } else {
                item.headersElement.style.marginLeft = "";
                headersLastElement.style.paddingRight = "";
            }
        }
        // 显示器缩放后像素存在小数点偏差 https://github.com/siyuan-note/siyuan/issues/7355
        if (rect.top <= 0 && rect.right + 8 >= window.innerWidth) {
            headersLastElement.style.paddingRight = (42 * ("darwin" === window.siyuan.config.system.os ? 1 : 4)) + "px";
        } else {
            headersLastElement.style.paddingRight = "";
        }
    });
};
