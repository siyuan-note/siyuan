import type {App} from "../index";
import {getDockByType} from "../layout/tabUtil";
import {openDock} from "../mobile/dock/util";
import {closePanel} from "../mobile/util/closePanel";
import {createFlashcardOutline} from "./flashcardOutline";

const hostSelector = "[data-workspace-review-outline]";
const contentSelector = "[data-workspace-review-outline-content]";

export const bindWorkspaceReviewOutline = (app: App, surface: HTMLElement, mobile: boolean,
                                           openSource: (blockID: string) => void) => {
    const reviewContent = surface.querySelector<HTMLElement>(".card__block");
    const outline = createFlashcardOutline(app, reviewContent, openSource);
    const modal = surface.querySelector<HTMLElement>(":scope > .b3-dialog");
    const drawer = () => document.querySelector<HTMLElement>('[data-type="sidebar-outline"]')?.closest<HTMLElement>(".side-panel");
    const available = () => mobile ?
        Boolean(document.querySelector('[data-type="sidebar-outline-tab"]:not(.fn__none)')) :
        Boolean(document.querySelector('.dock__item[data-type="outline"]:not(.fn__none)') && getDockByType("outline"));
    const panel = document.createElement("nav");
    panel.dataset.workspaceReviewOutlineContent = "";
    panel.className = "b3-list fn__flex-1";
    panel.tabIndex = -1;
    panel.setAttribute("aria-label", window.siyuan.languages.outline);
    let currentHost: HTMLElement;
    let raised: {element: HTMLElement, zIndex: string, position?: string, applied: string};
    let frame = 0;
    const restore = () => {
        if (raised) {
            if (raised.element.style.zIndex === raised.applied) {
                raised.element.style.zIndex = raised.zIndex;
            }
            if (raised.position !== undefined && raised.element.style.position === "relative") {
                raised.element.style.position = raised.position;
            }
            raised = undefined;
        }
    };
    const attach = (host?: HTMLElement) => {
        if (currentHost === host) {
            return;
        }
        if (currentHost) {
            panel.remove();
            if (!currentHost.querySelector(contentSelector)) {
                currentHost.classList.remove("workspace-review-outline--active");
            }
        }
        currentHost = host;
        if (host) {
            host.append(panel);
            host.classList.add("workspace-review-outline--active");
        }
        outline.mount(host ? panel : undefined);
    };
    const isActive = () => {
        if (!surface.isConnected || surface.dataset.dialogClosing === "true" || surface.closest(".fn__none")) {
            return false;
        }
        const topDialog = window.siyuan.dialogs.at(-1)?.element;
        if (modal) {
            return topDialog === surface && Boolean(raised);
        }
        const activeCenter = document.querySelector(".layout__center .layout__wnd--active");
        if (activeCenter) {
            return !topDialog && activeCenter.contains(surface);
        }
        const lastTab = Array.from(document.querySelectorAll<HTMLElement>(".layout__center .item--focus[data-activetime]"))
            .sort((a, b) => Number(b.dataset.activetime) - Number(a.dataset.activetime))[0];
        const fallbackCenter = lastTab?.closest('[data-type="wnd"]') ||
            document.querySelector('.layout__center [data-type="wnd"]');
        return !topDialog && Boolean(fallbackCenter?.contains(surface));
    };
    const refresh = () => {
        const host = document.querySelector<HTMLElement>(hostSelector);
        const visible = host && !host.closest(".fn__none") &&
            (!mobile || drawer()?.style.transform === "translateX(0px)") &&
            (mobile || Boolean(document.querySelector('.dock__item--active[data-type="outline"]')));
        if (raised && (!visible || !surface.isConnected || surface.dataset.dialogClosing === "true")) {
            restore();
        }
        attach(visible && isActive() ? host : undefined);
    };
    const observer = new MutationObserver(() => {
        if (!frame) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                refresh();
            });
        }
    });
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"]});

    const toggle = () => {
        if (!available()) {
            return false;
        }
        const dock = mobile ? undefined : getDockByType("outline");
        if (raised && currentHost) {
            if (mobile) {
                closePanel();
            } else {
                dock.toggleModel("outline", false, true);
            }
            restore();
            refresh();
            return true;
        }
        if (mobile) {
            openDock("outline");
        } else {
            dock.toggleModel("outline", Boolean(modal));
        }
        if (modal) {
            const element = mobile ? drawer() : dock.layout.element;
            if (element && !raised) {
                const applied = String(++window.siyuan.zIndex);
                raised = {element, zIndex: element.style.zIndex, applied};
                if (!mobile && getComputedStyle(element).position === "static") {
                    raised.position = element.style.position;
                    element.style.position = "relative";
                }
                element.style.zIndex = applied;
            }
        }
        refresh();
        if (modal && currentHost) {
            panel.focus();
        }
        return true;
    };
    return {
        available,
        toggle,
        update: (id?: string) => {
            outline.update(id);
            refresh();
        },
        reveal: outline.reveal,
        destroy: () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            attach();
            if (mobile && raised && drawer()?.style.transform === "translateX(0px)") {
                closePanel();
            }
            restore();
            outline.destroy();
        },
    };
};
