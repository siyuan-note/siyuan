import {isWindow} from "../util/functions";
import {Wnd} from "../layout/Wnd";
import {Layout} from "../layout";
import {getCurrentWindow} from "@electron/remote";

const getAllWnds = (layout: Layout, wnds: Wnd[]) => {
    for (let i = 0; i < layout.children.length; i++) {
        const item = layout.children[i];
        if (item instanceof Wnd) {
            wnds.push(item);
        } else if (item instanceof Layout) {
            getAllWnds(item, wnds);
        }
    }
}
export const setTabPosition = () => {
    if (!isWindow()) {
        return;
    }
    const wndsTemp: Wnd[] = []
    getAllWnds(window.siyuan.layout.layout, wndsTemp);
    wndsTemp.forEach(item => {
        const headerElement = item.headersElement.parentElement;
        const rect = headerElement.getBoundingClientRect()
        const dragElement = headerElement.querySelector('.item--readonly .fn__flex-1') as HTMLElement
        if (rect.top === 0) {
            dragElement.style.height = dragElement.parentElement.clientHeight + "px"
            // @ts-ignore
            dragElement.style.WebkitAppRegion = "drag";
        } else {
            // @ts-ignore
            dragElement.style.WebkitAppRegion = "";
        }
        if ("darwin" === window.siyuan.config.system.os) {
            if (rect.top <= 0 && rect.left <= 0 && !getCurrentWindow().isFullScreen()) {
                item.headersElement.style.paddingLeft = "69px";
            } else {
                item.headersElement.style.paddingLeft = "";
            }
        } else {
            if (rect.top <= 0 && rect.right >= window.innerWidth) {
                (headerElement.lastElementChild as HTMLElement).style.paddingRight = (32 * 3) + "px";
            } else {
                (headerElement.lastElementChild as HTMLElement).style.paddingRight = "";
            }
        }
    })
}
