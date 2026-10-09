import type {Dialog} from "../../dialog";
/// #if !BROWSER
import {initWindowControls} from "../../boot/windowControls";
import {isMac} from "../../protyle/util/compatibility";
/// #endif

// 页面铺满原生窗口，内部确认框仍使用普通 Dialog 的覆盖范围和焦点管理。
export const fitSettingsWindowDialog = (dialog: Dialog) => {
    dialog.element.querySelector(".b3-dialog").classList.add("b3-dialog--window");
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.maxWidth = "none";
    container.style.left = "auto";
    container.style.top = "auto";
    container.setAttribute("aria-modal", "false");
    dialog.element.querySelectorAll(".resize__move").forEach(element => element.classList.remove("resize__move"));
    dialog.element.querySelector(".config__tab-title")?.remove();
    /// #if !BROWSER
    const header = container.querySelector<HTMLElement>(".b3-dialog__header");
    const title = header.textContent || document.title;
    header.className = "toolbar toolbar--settings fn__flex";
    const drag = document.createElement("div");
    drag.id = "drag";
    drag.className = "fn__flex-1";
    drag.textContent = title;
    header.replaceChildren(drag);
    container.setAttribute("aria-labelledby", header.id);
    if (!isMac()) {
        const controls = document.createElement("div");
        controls.id = "windowControls";
        controls.className = "fn__flex";
        header.append(controls);
        initWindowControls(controls, () => dialog.destroy());
    }
    const updateTitleInset = () => {
        const style = getComputedStyle(header);
        const controls = header.querySelector("#windowControls");
        const inset = Math.max(parseFloat(style.paddingLeft), parseFloat(style.paddingRight),
            controls?.getBoundingClientRect().width || 0);
        header.style.setProperty("--settings-window-title-inset", inset + "px");
    };
    const observer = new ResizeObserver(updateTitleInset);
    observer.observe(header);
    const controls = header.querySelector("#windowControls");
    if (controls) observer.observe(controls);
    updateTitleInset();
    window.addEventListener("unload", () => observer.disconnect(), {once: true});
    /// #endif
};
