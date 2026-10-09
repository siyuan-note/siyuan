import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {getAVData} from "../virtualScroll";
import {loadMapServices} from "./settings";
import {openMapRecord} from "./openRecord";
import {canLoadMapHost, destroyMap, getMapPoints, getMapSettings, registerMap} from "./state";
import {createAVMapHost, isAVMapHostEnvironmentSupported} from "./host";
import {createDesktopAVMapHost, isDesktopAVMapHostSupported} from "./desktopTransport";
import type {AVMapHost} from "./host";
import {AV_MAP_ATTRIBUTION_LINKS, AV_MAP_MAX_POINTS} from "./protocol";
import {MAP_CONFIG_CHANGED_EVENT} from "../../../../config/mapRuntime";

const getTheme = () => document.documentElement.getAttribute("data-theme-mode") === "dark" ? "dark" : "light";

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
    root.innerHTML = `<div class="av__map-summary ft__smaller ft__on-surface">${escapeHtml(pageText)}</div>
<div class="av__map-skipped ft__smaller ft__on-surface"></div>
<div class="av__map-status ft__on-surface" role="status"></div>
<div class="av__map-canvas fn__none"></div>
<div class="ft__smaller fn__none" data-map-attribution></div>
<div class="av__map-actions">
    <button type="button" class="b3-button b3-button--outline fn__none" data-map-fit>${window.siyuan.languages.mapFitMarkers}</button>
    <button type="button" class="block__icon block__icon--show ariaLabel" data-map-retry aria-label="${escapeAttr(window.siyuan.languages.refresh)}"><svg><use xlink:href="#iconRefresh"></use></svg></button>
</div>`;
    records.before(root);
    ["click", "keydown", "pointerdown"].forEach(type => root.addEventListener(type, event => event.stopPropagation()));
    const status = root.querySelector<HTMLElement>(".av__map-status");
    const canvas = root.querySelector<HTMLElement>(".av__map-canvas");
    const attribution = root.querySelector<HTMLElement>("[data-map-attribution]");
    const fitButton = root.querySelector<HTMLButtonElement>("[data-map-fit]");
    const retryButton = root.querySelector<HTMLButtonElement>("[data-map-retry]");
    let host: AVMapHost;
    let themeObserver: MutationObserver;
    let resizeObserver: ResizeObserver;
    let revision = 0;
    const offline = () => fallback(window.siyuan.languages.mapOffline);
    const configChanged = () => { void renderMap(blockElement, protyle, data); };
    const current = registerMap(blockElement, {root, destroy: () => {
        revision++;
        host?.destroy();
        themeObserver?.disconnect();
        resizeObserver?.disconnect();
        window.removeEventListener("offline", offline);
        window.removeEventListener(MAP_CONFIG_CHANGED_EVENT, configChanged);
    }});
    const fallback = (message: string) => {
        if (!current()) {
            return;
        }
        revision++;
        host?.destroy();
        host = undefined;
        attribution.classList.add("fn__none");
        status.textContent = message;
        canvas.classList.add("fn__none");
        fitButton.classList.add("fn__none");
    };
    retryButton.addEventListener("click", () => { void renderMap(blockElement, protyle, data); });
    if (window.siyuan.isPublish) {
        retryButton.classList.add("fn__none");
        fallback(window.siyuan.languages.mapPublicFallback);
        return;
    }
    if (protyle.options.history?.created || protyle.options.history?.snapshot) {
        retryButton.classList.add("fn__none");
        fallback(window.siyuan.languages.mapUnsupportedClient);
        return;
    }
    window.addEventListener(MAP_CONFIG_CHANGED_EVENT, configChanged);
    try {
        const services = await loadMapServices();
        if (!current()) {
            return;
        }
        if (!settings.locationKeyID) {
            fallback(window.siyuan.languages.mapSelectLocationField);
            return;
        }
        if (!view.columns.some(column => column.id === settings.locationKeyID && column.type === "location")) {
            fallback(window.siyuan.languages.mapMissingLocationField);
            return;
        }
        if (!settings.serviceID) {
            fallback(window.siyuan.languages.mapSelectService);
            return;
        }
        const service = services.find(service => service.id === settings.serviceID);
        if (!service) {
            fallback(window.siyuan.languages.mapMissingService);
            return;
        }
        const {points, skipped} = getMapPoints(view, service.provider);
        root.querySelector(".av__map-skipped").textContent = Object.entries(skipped).reduce((text, [key, value]) =>
            text.replace("${" + key + "}", value.toString()), window.siyuan.languages.mapSkippedLocations);
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
        if (!service.configured) {
            fallback(window.siyuan.languages.mapCredentialsMissing);
            return;
        }
        status.textContent = window.siyuan.languages.mapLoading;
        const response = await fetchSyncPost("/api/map/getRuntime", {serviceID: settings.serviceID});
        if (!current()) {
            return;
        }
        if (response.code !== 0 || response.data.provider !== service.provider) {
            fallback(response.msg === "mapAuthenticationBypass" ? window.siyuan.languages.mapAuthenticationBypass :
                window.siyuan.languages.mapLoadError);
            return;
        }
        const rowByID = new Map(view.rows.map(row => [row.id, row]));
        const pointIDs = new Set(points.map(point => point.id));
        const activeRevision = ++revision;
        // 固定官方署名链接留在父页，避免为第三方 SDK 放宽沙箱弹窗权限。
        attribution.innerHTML = AV_MAP_ATTRIBUTION_LINKS[service.provider].map(link =>
            `<a href="${escapeAttr(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`).join(" · ");
        canvas.classList.remove("fn__none");
        host = (desktopHost ? createDesktopAVMapHost : createAVMapHost)(canvas, {
            provider: response.data.provider,
            credentials: {apiKey: response.data.apiKey, securityCode: response.data.securityCode},
            theme: getTheme(),
            title: window.siyuan.languages.mapView,
            onReady: () => {
                if (!current() || revision !== activeRevision) {
                    return;
                }
                status.textContent = "";
                attribution.classList.remove("fn__none");
                fitButton.classList.remove("fn__none");
            },
            onError: () => fallback(navigator.onLine ? window.siyuan.languages.mapLoadError : window.siyuan.languages.mapOffline),
            onMarkerClick: (id, markerRevision) => {
                if (current() && markerRevision === activeRevision && revision === activeRevision && pointIDs.has(id)) {
                    void openMapRecord(protyle, blockElement, rowByID.get(id));
                }
            },
        });
        host.setPoints(points, activeRevision);
        fitButton.addEventListener("click", () => host?.fit());
        themeObserver = new MutationObserver(() => host?.setTheme(getTheme()));
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode"]});
        resizeObserver = new ResizeObserver(() => host?.resize());
        resizeObserver.observe(canvas);
        window.addEventListener("offline", offline);
    } catch (_error) {
        fallback(window.siyuan.languages.mapLoadError);
    }
};
