/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import type {AVMapHost, AVMapHostOptions} from "./host";
import {isMapUnplacedMenu} from "./unplacedMenu";
import {
    AV_MAP_PROTOCOL_VERSION, AVMapCommand, AVMapErrorCode, AVMapPoint, isAVMapHostErrorCode, isAVMapProvider, isAVMapRevision,
    isAVMapTheme, parseAVMapReply, sanitizeAVMapPoints,
} from "./protocol";

interface MapRect { x: number; y: number; width: number; height: number; }
type MapGeometry = {visible: false} | {
    visible: true; bounds: MapRect; logicalSize: {width: number; height: number}; crop: {x: number; y: number};
};

const intersects = (a: MapRect, b: MapRect) => a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;

// 菜单打开时不展示难以操作的狭窄残片。
const MIN_MENU_MAP_EDGE = 32;
const MIN_MENU_MAP_AREA = 4096;

// All coordinates stay in owner CSS pixels. Only the main process applies the owner zoom factor.
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

const getIPC = () => {
    /// #if !BROWSER
    return ipcRenderer;
    /// #else
    return undefined;
    /// #endif
};

const capabilityFailureReasons = new Set([
    "ownerUnavailable", "notMainFrame", "notInitialized", "unregisteredOwner", "invalidKernelOrigin",
    "originMismatch", "unsupportedDocument", "invalidDocument", "unsafeProcessSwitches",
]);

const mapDiagnosticCodes = new Set([
    "hostSetupFailed", "assetUnavailable", "documentLoadFailed", "bootstrapTimeout", "sdkTimeout",
    "providerRequestDenied", "providerInsecureRequest", "providerHTTPFailure", "providerNetworkFailure",
    "cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm",
    "storageUnavailable", "webglUnavailable", "geometryInvalid", "geometryLogicalBounds",
    "geometryCropBounds", "geometryWindowBounds", "geometryRoundedEmpty",
]);
const mapCSPDiagnosticCodes = new Set(["cspScript", "cspWorker", "cspConnect", "cspImage", "cspStyle", "cspEval", "cspWasm"]);
const mapCSPResourceCodes = new Set([
    "blob", "data", "inline", "eval", "wasm", "other",
    "owner-origin", "local-address", "redacted",
]);
const isMapCSPResource = (value: unknown): value is string => {
    if (typeof value !== "string" || value.length > 102) return false;
    if (mapCSPResourceCodes.has(value)) return true;
    return value === "https:tiles.openfreemap.org" || value === "http:tiles.openfreemap.org";
};
const logMapDiagnostic = (code: unknown, resource?: unknown) => {
    if (typeof code === "string" && mapDiagnosticCodes.has(code)) {
        if (resource === undefined) {
            console.warn("Database map diagnostic:", code);
        } else if (mapCSPDiagnosticCodes.has(code) && isMapCSPResource(resource)) {
            console.warn("Database map diagnostic:", code, resource);
        }
    }
};

export const isDesktopAVMapHostSupported = async (): Promise<boolean> => {
    const ipc = getIPC();
    if (!ipc) {
        return false;
    }
    try {
        const reply = await ipc.invoke("siyuan-map-capability");
        if (reply?.version === AV_MAP_PROTOCOL_VERSION && reply.supported === true) {
            return true;
        }
        // 主进程返回值也仅按固定码记录，避免日志输出任意异常、URL 或凭据。
        const reason = reply?.version === AV_MAP_PROTOCOL_VERSION && capabilityFailureReasons.has(reply.reason) ?
            reply.reason : "unsupportedCapability";
        console.warn("Database map host unavailable:", reason);
    } catch (_error) {
        console.warn("Database map host unavailable:", "capabilityUnavailable");
    }
    return false;
};

const readGeometry = (container: HTMLElement): MapGeometry => {
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
    // These are actual application overlay roots, not guesses based on arbitrary z-index values.
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
        // Hit-test the owner's DOM (native child views are not in this tree), including sticky toolbars.
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

export const createDesktopAVMapHost = (container: HTMLElement, options: AVMapHostOptions): AVMapHost => {
    const scope = container.ownerDocument.defaultView;
    const ipc = getIPC();
    let destroyed = false, ready = false, created = false, pendingFit = false;
    let instanceID = "", revision = -1, theme = options.theme;
    let points: AVMapPoint[] = [];
    let ids = new Set<string>();
    let frame = 0, timeout = 0, stableAfter = 0, scrollingUntil = 0;
    let lastGeometry = "", sentGeometry = "";
    const diagnostics = new Set<string>();
    let observer: MutationObserver;
    let resizeObserver: ResizeObserver;
    const envelope = () => ({version: AV_MAP_PROTOCOL_VERSION, instanceID} as const);
    const send = (command: AVMapCommand) => {
        if (!destroyed && ready) {
            ipc.send("siyuan-map-command", command);
        }
    };
    const geometry = (value: MapGeometry) => {
        const key = JSON.stringify(value);
        if (created && key !== sentGeometry) {
            ipc.send("siyuan-map-geometry", {...envelope(), ...value});
            sentGeometry = key;
        }
    };
    const invalidate = () => {
        if (!destroyed && scope) {
            stableAfter = scope.performance.now() + 120;
            geometry({visible: false});
        }
    };
    const checkGeometry = () => {
        const next = readGeometry(container);
        const key = JSON.stringify(next);
        if (key !== lastGeometry) {
            lastGeometry = key;
            if (scope.performance.now() < scrollingUntil) {
                stableAfter = 0;
                geometry(next);
            } else {
                stableAfter = scope.performance.now() + 120;
                geometry({visible: false});
            }
        }
        if (!next.visible) {
            geometry(next);
        }
        return next;
    };
    const onScroll = () => {
        if (!destroyed && scope) {
            // 滚动和同轮固定栏布局更新都使用完整遮挡检查后的最新裁剪，不等待滚动停止。
            scrollingUntil = scope.performance.now() + 120;
            stableAfter = 0;
            geometry(checkGeometry());
        }
    };
    const onFocus = () => {
        if (!destroyed) {
            // 从原生地图回到编辑器只复核布局；实际几何或遮挡变化仍会立即隐藏地图。
            checkGeometry();
        }
    };
    const tick = () => {
        if (destroyed) {
            return;
        }
        const next = checkGeometry();
        if (!next.visible || scope.performance.now() >= stableAfter) {
            geometry(next);
        }
        frame = scope.requestAnimationFrame(tick);
    };
    const destroy = () => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        ready = false;
        if (instanceID) {
            ipc?.send("siyuan-map-destroy", envelope());
        }
        ipc?.removeListener("siyuan-map-reply", onReply);
        scope?.clearTimeout(timeout);
        scope?.cancelAnimationFrame(frame);
        scope?.removeEventListener("pagehide", destroy);
        scope?.removeEventListener("scroll", onScroll, true);
        scope?.removeEventListener("resize", invalidate);
        scope?.removeEventListener("focus", onFocus);
        container.ownerDocument.removeEventListener("visibilitychange", invalidate);
        observer?.disconnect();
        resizeObserver?.disconnect();
        points = [];
        ids.clear();
    };
    const fail = (code: AVMapErrorCode) => {
        if (!destroyed) {
            console.warn("Database map failed:", code);
            destroy();
            options.onError(code);
        }
    };
    const postPoints = () => {
        if (revision >= 0) {
            send({...envelope(), type: "setPoints", points, revision});
        }
    };
    const onReply = (_event: unknown, value: unknown) => {
        if (destroyed) {
            return;
        }
        const diagnostic = value as {version?: unknown; instanceID?: unknown; type?: unknown; code?: unknown; resource?: unknown};
        if (diagnostic?.version === AV_MAP_PROTOCOL_VERSION && diagnostic.instanceID === instanceID && diagnostic.type === "diagnostic") {
            if (typeof diagnostic.code !== "string" || !mapDiagnosticCodes.has(diagnostic.code) ||
                diagnostic.resource !== undefined && (!mapCSPDiagnosticCodes.has(diagnostic.code) ||
                    !isMapCSPResource(diagnostic.resource))) return;
            const key = diagnostic.code + ":" + (diagnostic.resource || "");
            if (diagnostics.has(key) || diagnostics.size >= 64) return;
            diagnostics.add(key);
            logMapDiagnostic(diagnostic.code, diagnostic.resource);
            return;
        }
        const reply = parseAVMapReply(value, instanceID);
        if (reply?.type === "ready" && !ready) {
            ready = true;
            scope.clearTimeout(timeout);
            postPoints();
            send({...envelope(), type: "theme", theme});
            if (pendingFit) {
                send({...envelope(), type: "fit"});
                pendingFit = false;
            }
            options.onReady?.();
        } else if (reply?.type === "markerClick" && ready && reply.revision === revision && ids.has(reply.id)) {
            options.onMarkerClick(reply.id, reply.revision);
        } else if (reply?.type === "attributionClick" && ready) {
            // 主进程已校验原生视图可见性，并消费一次可信用户输入。
            options.onAttributionClick?.(reply.link);
        } else if (reply?.type === "error") {
            fail(reply.code);
        }
    };
    const host: AVMapHost = {
        setPoints: (input, nextRevision) => {
            if (!destroyed && isAVMapRevision(nextRevision) && nextRevision > revision) {
                revision = nextRevision;
                points = sanitizeAVMapPoints(input);
                ids = new Set(points.map((point) => point.id));
                postPoints();
            }
        },
        fit: () => {
            if (!destroyed) {
                if (ready) { send({...envelope(), type: "fit"}); } else { pendingFit = true; }
            }
        },
        resize: invalidate,
        setTheme: (nextTheme) => {
            if (!destroyed && isAVMapTheme(nextTheme)) {
                theme = nextTheme;
                send({...envelope(), type: "theme", theme});
            }
        },
        destroy,
    };
    if (!scope || !ipc) {
        queueMicrotask(() => fail("unsupportedEnvironment"));
        return host;
    }
    if (!isAVMapProvider(options.provider) || !isAVMapTheme(options.theme)) {
        queueMicrotask(() => fail("invalidConfiguration"));
        return host;
    }
    const start = async () => {
        const bytes = new Uint8Array(24);
        scope.crypto.getRandomValues(bytes);
        instanceID = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        ipc.on("siyuan-map-reply", onReply);
        scope.addEventListener("pagehide", destroy, {once: true});
        // 主进程先等待引导 30 秒，再为 SDK 两个 20 秒阶段保留 45 秒；这里只做更晚的失联兜底。
        timeout = scope.setTimeout(() => fail("hostReadyTimeout"), 90000);
        let reply: {version?: number; instanceID?: string; error?: unknown; diagnostic?: unknown};
        try {
            reply = await ipc.invoke("siyuan-map-create", {...envelope(), provider: options.provider, theme});
        } catch (_error) {
            fail("hostCreateRejected");
            return;
        }
        // Creation can finish after disposal. Tell main again, even if the first destroy arrived too early.
        if (destroyed) {
            ipc.send("siyuan-map-destroy", envelope());
            return;
        }
        if (reply?.version !== AV_MAP_PROTOCOL_VERSION || reply.instanceID !== instanceID) {
            fail("hostCreateInvalidResponse");
            return;
        }
        if (reply.error) {
            logMapDiagnostic(reply?.diagnostic);
            fail(reply.error === "unsupportedEnvironment" ? "unsupportedEnvironment" :
                isAVMapHostErrorCode(reply.error) ? reply.error : "hostCreateInvalidResponse");
            return;
        }
        created = true;
        scope.addEventListener("scroll", onScroll, true);
        scope.addEventListener("resize", invalidate);
        // DOM 焦点会在编辑器与原生地图间切换，窗口是否隐藏由主进程与文档可见性共同判断。
        scope.addEventListener("focus", onFocus);
        container.ownerDocument.addEventListener("visibilitychange", invalidate);
        observer = new MutationObserver(() => {
            // 悬停提示和块标也会改变 DOM；仅地图几何或遮挡变化需要隐藏原生视图。
            if (!destroyed) {
                checkGeometry();
            }
        });
        observer.observe(container.ownerDocument.documentElement, {childList: true, subtree: true,
            attributes: true, attributeFilter: ["class", "style", "hidden", "open"]});
        resizeObserver = new ResizeObserver(invalidate);
        resizeObserver.observe(container);
        tick();
    };
    void start().catch(() => fail("hostOwnerSetupFailed"));
    return host;
};
