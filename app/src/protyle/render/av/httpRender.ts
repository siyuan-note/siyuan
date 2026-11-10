import {fetchSyncPost} from "../../../util/fetch";
import {isAVRenderData} from "./renderData";
import type {RenderAttributeViewRequestInput} from "../../../types/api";

export type AVAutomaticRefresh = boolean | "presentation";
const loadingOwners = new WeakMap<HTMLElement, symbol>();

// 首屏先返回无需联网的字段与条目；完成宿主渲染后才执行需要确认的请求。
export const fetchAVRender = async (request: RenderAttributeViewRequestInput, signal: AbortSignal,
                                    owner: HTMLElement, isCurrent: () => boolean,
                                    preview: (data: IAV) => Promise<void>) => {
    const firstRender = !owner.querySelector(".av__header") && !window.siyuan.isPublish;
    if (!firstRender) {
        return fetchSyncPost("/api/av/renderAttributeView", request, undefined, false, signal);
    }
    const initial = await fetchSyncPost("/api/av/renderAttributeView", {...request, deferHTTPTemplates: true},
        undefined, false, signal);
    if (!isCurrent() || signal.aborted || initial.code !== 0 || !isAVRenderData(initial.data) ||
        !("pendingHTTPTemplates" in initial.data) || !initial.data.pendingHTTPTemplates?.length) {
        return initial;
    }
    await preview(initial.data as IAV);
    if (!isCurrent() || signal.aborted) {
        return initial;
    }
    const pending = initial.data.pendingHTTPTemplates;
    const indicators: HTMLElement[] = [];
    pending.forEach(id => {
        owner.querySelectorAll<HTMLElement>(`.av__cell[data-col-id="${CSS.escape(id)}"], .av__cell[data-field-id="${CSS.escape(id)}"]`).forEach(cell => {
            if (cell.closest(".av__row--header")) {
                return;
            }
            const indicator = document.createElement("span");
            indicator.className = "av__pulse";
            indicator.setAttribute("role", "progressbar");
            indicator.setAttribute("aria-label", window.siyuan.languages.templateHTTPRequesting);
            cell.replaceChildren(indicator);
            indicators.push(indicator);
        });
    });
    if (!indicators.length) {
        const indicator = document.createElement("span");
        indicator.className = "av__pulse";
        indicator.setAttribute("role", "progressbar");
        indicator.setAttribute("aria-label", window.siyuan.languages.templateHTTPRequesting);
        owner.querySelector(".av__title")?.after(indicator);
        indicators.push(indicator);
    }
    const loading = Symbol();
    loadingOwners.set(owner, loading);
    owner.setAttribute("aria-busy", "true");
    try {
        return await fetchSyncPost("/api/av/renderAttributeView", request, undefined, false, signal);
    } finally {
        indicators.forEach(indicator => indicator.remove());
        if (loadingOwners.get(owner) === loading) {
            loadingOwners.delete(owner);
            owner.removeAttribute("aria-busy");
        }
    }
};
