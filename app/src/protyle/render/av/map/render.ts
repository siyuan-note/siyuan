import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {transaction} from "../../../wysiwyg/transaction";
import {waitForPendingTransactions} from "../../../util/transactionQueue";
import {avRender} from "../render";
import {getAVData} from "../virtualScroll";
import {openMapRecord} from "./openRecord";
import {canEditMapSettings} from "./settings";
import {canLoadMapHost, destroyMap, getMapPoints, getMapSettings, registerMap} from "./state";
import {createAVMapHost, isAVMapHostEnvironmentSupported} from "./host";
import {createDesktopAVMapHost, isDesktopAVMapHostSupported} from "./desktopTransport";
import type {AVMapHost} from "./host";
import {AV_MAP_ATTRIBUTION_LINKS, AV_MAP_MAX_POINTS} from "./protocol";
import {bindMapUnplaced} from "./unplaced";

const getTheme = () => document.documentElement.getAttribute("data-theme-mode") === "dark" ? "dark" : "light";

const renderMapSetup = (root: HTMLElement, blockElement: HTMLElement, protyle: IProtyle,
                        data: IAV, current: () => boolean) => {
    const view = data.view as IAVTable;
    const previous = {locationKeyID: view.map?.locationKeyID || ""};
    const editable = canEditMapSettings(protyle);
    const message = previous.locationKeyID ? window.siyuan.languages.mapMissingLocationField :
        window.siyuan.languages.mapSelectLocationField;
    root.querySelector(".av__map-status").innerHTML = `<div class="av__map-empty">
    <svg aria-hidden="true"><use xlink:href="#iconGlobe"></use></svg><p>${escapeHtml(message)}</p>
    ${editable ? `<div class="av__map-setup"><label class="av__map-setting"><span>${escapeHtml(window.siyuan.languages.mapLocationField)}</span>
        <select class="b3-select" data-map-location-field aria-label="${escapeAttr(window.siyuan.languages.mapLocationField)}">
            <option value="">${escapeHtml(window.siyuan.languages.mapSelectLocationField)}</option>
            ${view.columns.filter(column => column.type === "location").map(column =>
        `<option value="${escapeAttr(column.id)}">${escapeHtml(column.name)}</option>`).join("")}
        </select></label></div>
    <div class="av__map-create-fields"><button class="b3-button b3-button--outline" data-map-create-field>
        ${escapeHtml(window.siyuan.languages.newCol)} ${escapeHtml(window.siyuan.languages.location)}</button></div>` : ""}
</div>`;
    if (!editable) return;
    const select = root.querySelector<HTMLSelectElement>("[data-map-location-field]");
    const create = root.querySelector<HTMLButtonElement>("[data-map-create-field]");
    const context = {avID: data.id, blockID: blockElement.dataset.nodeId, viewID: data.viewID};
    let pending = false;
    const submit = async (locationKeyID?: string) => {
        if (pending || !current() || !canEditMapSettings(protyle)) return;
        if (locationKeyID !== undefined && (!locationKeyID ||
            !view.columns.some(column => column.id === locationKeyID && column.type === "location"))) return;
        pending = true;
        select.disabled = true;
        create.disabled = true;
        let committed = false;
        try {
            const id = locationKeyID || Lute.NewNodeID();
            const update: IOperation = {...context, action: "setAttrViewMap", data: {locationKeyID: id}};
            const undo: IOperation = {...context, action: "setAttrViewMap", data: previous};
            transaction(protyle, locationKeyID ? [update] : [
                {...context, action: "addAttrViewCol", id, type: "location", name: window.siyuan.languages.location},
                update,
                {...context, action: "setAttrViewColHidden", id, viewIDs: [data.viewID], data: true},
            ], locationKeyID ? [undo] : [undo, {...context, action: "removeAttrViewCol", id}], {
                callback: () => {
                    committed = true;
                    if (current()) {
                        blockElement.removeAttribute("data-render");
                        avRender(blockElement, protyle);
                    }
                },
            });
            await waitForPendingTransactions(protyle);
        } finally {
            if (!committed && current()) {
                pending = false;
                select.value = "";
                select.disabled = !canEditMapSettings(protyle);
                create.disabled = select.disabled;
            }
        }
    };
    select.addEventListener("change", () => { void submit(select.value); });
    create.addEventListener("click", () => { void submit(); });
};

export const refreshMapReadonly = (protyle: IProtyle) => {
    protyle.wysiwyg.element.querySelectorAll<HTMLElement>('.av[data-av-type="map"]').forEach(block => {
        const data = getAVData(block);
        if (data?.viewType === "map") {
            void renderMap(block, protyle, data);
        }
    });
};

export const renderMap = async (blockElement: HTMLElement, protyle: IProtyle, data: IAV) => {
    destroyMap(blockElement);
    blockElement.querySelector(":scope > .av__container > .av__map")?.remove();
    const records = blockElement.querySelector<HTMLElement>(":scope > .av__container > .av__scroll");
    if (!records) {
        return;
    }
    const view = data.view as IAVTable;
    const settings = getMapSettings(view);
    const root = document.createElement("div");
    root.className = "av__map";
    root.setAttribute("contenteditable", "false");
    root.setAttribute("aria-label", window.siyuan.languages.mapView);
    const pageText = window.siyuan.languages.mapPageScope.replace("${shown}", view.rows.length.toString())
        .replace("${total}", view.rowCount.toString());
    const loadedText = window.siyuan.languages.mapLoadedCount.replace("${shown}", view.rows.length.toString())
        .replace("${total}", view.rowCount.toString());
    const hasLocationField = view.columns.some(column => column.id === settings.locationKeyID && column.type === "location");
    root.innerHTML = `<div class="av__map-toolbar">
<div class="av__map-summary ft__smaller ft__on-surface b3-tooltips b3-tooltips__nw" aria-label="${escapeAttr(pageText)}" tabindex="0">
    <span>${escapeHtml(loadedText)}</span><span class="av__map-skipped"></span>
</div>
${hasLocationField && canEditMapSettings(protyle) ? `<button type="button" class="block__icon block__icon--show ariaLabel fn__none" data-map-unplaced-toggle data-position="8south" aria-label="${escapeAttr(window.siyuan.languages.mapUnplaced)}" aria-expanded="false"><svg><use xlink:href="#iconInbox"></use></svg></button>` : ""}
</div>
<div class="av__map-status ft__on-surface" role="status"></div>
<div class="av__map-canvas fn__none"></div>
`;
    records.before(root);
    ["click", "keydown", "pointerdown"].forEach(type => root.addEventListener(type, event => event.stopPropagation()));
    const status = root.querySelector<HTMLElement>(".av__map-status");
    const canvas = root.querySelector<HTMLElement>(".av__map-canvas");
    let host: AVMapHost;
    let themeObserver: MutationObserver;
    let resizeObserver: ResizeObserver;
    let destroyUnplaced: () => void;
    let revision = 0;
    const offline = () => fallback(window.siyuan.languages.mapOffline);
    const current = registerMap(blockElement, {root, destroy: () => {
        revision++;
        host?.destroy();
        themeObserver?.disconnect();
        resizeObserver?.disconnect();
        destroyUnplaced?.();
        window.removeEventListener("offline", offline);
    }});
    const fallback = (message: string) => {
        if (!current()) {
            return;
        }
        revision++;
        host?.destroy();
        host = undefined;
        status.textContent = message;
        canvas.classList.add("fn__none");
    };
    if (window.siyuan.isPublish) {
        fallback(window.siyuan.languages.mapPublicFallback);
        return;
    }
    if (protyle.options.history?.created || protyle.options.history?.snapshot) {
        fallback(window.siyuan.languages.mapUnsupportedClient);
        return;
    }
    try {
        if (!hasLocationField) {
            renderMapSetup(root, blockElement, protyle, data, current);
            return;
        }
        if (canEditMapSettings(protyle)) destroyUnplaced = bindMapUnplaced({root, blockElement, protyle, data, current});
        const {points, skipped} = getMapPoints(view);
        const skippedCount = skipped.empty + skipped.invalid + skipped.projection;
        if (skippedCount) {
            const skippedElement = root.querySelector(".av__map-skipped");
            skippedElement.textContent = window.siyuan.languages.mapSkippedCount.replace("${count}", skippedCount.toString());
            const skippedText = Object.entries(skipped).reduce((text, [key, value]) =>
                text.replace("${" + key + "}", value.toString()), window.siyuan.languages.mapSkippedLocations);
            root.querySelector(".av__map-summary").setAttribute("aria-label", `${pageText}\n${skippedText}`);
        }
        if (!canLoadMapHost({published: false, history: false, protocol: window.location.protocol})) {
            fallback(window.siyuan.languages.mapUnsupportedClient);
            return;
        }
        const desktopHost = await isDesktopAVMapHostSupported();
        const hostSupported = desktopHost || await isAVMapHostEnvironmentSupported();
        if (!current()) {
            return;
        }
        if (!hostSupported) {
            fallback(window.siyuan.languages.mapUnsupportedClient);
            return;
        }
        if (!points.length) {
            fallback(window.siyuan.languages.mapNoMarkers);
            return;
        }
        if (points.length > AV_MAP_MAX_POINTS) {
            fallback(window.siyuan.languages.mapTooManyMarkers.replace("${limit}", AV_MAP_MAX_POINTS.toString()));
            return;
        }
        if (!navigator.onLine) {
            fallback(window.siyuan.languages.mapOffline);
            return;
        }
        status.textContent = window.siyuan.languages.mapLoading;
        const response = await fetchSyncPost("/api/map/getRuntime", {});
        if (!current()) {
            return;
        }
        if (response.code !== 0 || response.data?.provider !== "openfreemap") {
            fallback(response.msg === "mapAuthenticationBypass" ? window.siyuan.languages.mapAuthenticationBypass :
                window.siyuan.languages.mapLoadError);
            return;
        }
        const rowByID = new Map(view.rows.map(row => [row.id, row]));
        const pointIDs = new Set(points.map(point => point.id));
        const activeRevision = ++revision;
        canvas.classList.remove("fn__none");
        host = (desktopHost ? createDesktopAVMapHost : createAVMapHost)(canvas, {
            provider: "openfreemap",
            theme: getTheme(),
            title: window.siyuan.languages.mapView,
            onReady: () => {
                if (!current() || revision !== activeRevision) {
                    return;
                }
                status.textContent = "";
            },
            onAttributionClick: id => {
                if (!current() || revision !== activeRevision) return;
                // 仅可信父页面解析固定官方链接，供应商 URL 不跨越隔离边界。
                const link = AV_MAP_ATTRIBUTION_LINKS.openfreemap.find(item => item.id === id);
                if (link) window.open(link.href, "_blank", "noopener,noreferrer");
            },
            onError: () => fallback(navigator.onLine ? window.siyuan.languages.mapLoadError : window.siyuan.languages.mapOffline),
            onMarkerClick: (id, markerRevision) => {
                if (current() && markerRevision === activeRevision && revision === activeRevision && pointIDs.has(id)) {
                    void openMapRecord(protyle, blockElement, rowByID.get(id));
                }
            },
        });
        host.setPoints(points, activeRevision);
        themeObserver = new MutationObserver(() => host?.setTheme(getTheme()));
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode"]});
        resizeObserver = new ResizeObserver(() => host?.resize());
        resizeObserver.observe(canvas);
        window.addEventListener("offline", offline);
    } catch (_error) {
        fallback(window.siyuan.languages.mapLoadError);
    }
};
