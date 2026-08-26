type TMobileInputEvent = MouseEvent | PointerEvent | TouchEvent;

const TRACKED_INPUT_SELECTOR = "#sidebar, #sidebarRight, #menu, #model, #mobileBottomBar, .side-mask";

let initialized = false;
let resizeTimer = 0;
let flushTimer = 0;
const pendingLogs: string[] = [];

const queueLog = (details: string) => {
    pendingLogs.push(details);
    if (pendingLogs.length > 40) {
        pendingLogs.shift();
    }
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
        const logs = pendingLogs.splice(0);
        logs.forEach(log => window.JSAndroid?.logInputEvent?.(log));
        flushTimer = 0;
    }, 150);
};

const describeElement = (element?: Element | null) => {
    if (!element) {
        return "none";
    }
    const classes = element.getAttribute("class")?.trim().split(/\s+/).slice(0, 4).join(".") || "";
    return [
        element.tagName.toLowerCase(),
        element.id ? `id=${element.id}` : "",
        element.getAttribute("data-type") ? `data-type=${element.getAttribute("data-type")}` : "",
        classes ? `class=${classes}` : "",
    ].filter(Boolean).join(" ");
};

const getEventPoint = (event?: TMobileInputEvent): {clientX: number, clientY: number} | undefined => {
    if (!event) {
        return;
    }
    if ("changedTouches" in event && event.changedTouches.length > 0) {
        return {
            clientX: event.changedTouches[0].clientX,
            clientY: event.changedTouches[0].clientY,
        };
    }
    return {
        clientX: (event as MouseEvent).clientX,
        clientY: (event as MouseEvent).clientY,
    };
};

const getLayoutDetails = () => {
    const visualViewport = window.visualViewport;
    const mobileBodyClasses = Array.from(document.body.classList)
        .filter(item => item.startsWith("mobile-"))
        .join(".") || "none";
    const maskElement = document.querySelector(".side-mask");
    return [
        `orientation=${window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait"}`,
        `inner=${window.innerWidth}x${window.innerHeight}`,
        `screen=${window.screen.width}x${window.screen.height}`,
        `visual=${visualViewport ? `${Math.round(visualViewport.width)}x${Math.round(visualViewport.height)}` : "unavailable"}`,
        `visualOffset=${visualViewport ? `${Math.round(visualViewport.offsetLeft)},${Math.round(visualViewport.offsetTop)}` : "unavailable"}`,
        `visualScale=${visualViewport?.scale ?? "unavailable"}`,
        `body=${mobileBodyClasses}`,
        `maskHidden=${maskElement?.classList.contains("fn__none") ?? "unavailable"}`,
        `sidebarTransform=${document.getElementById("sidebar")?.style.transform || "none"}`,
        `sidebarRightTransform=${document.getElementById("sidebarRight")?.style.transform || "none"}`,
        `menuHidden=${document.getElementById("menu")?.classList.contains("fn__none") ?? "unavailable"}`,
        `modelTransform=${document.getElementById("model")?.style.transform || "none"}`,
    ];
};

const formatExtraDetails = (details?: Record<string, unknown>) => {
    return Object.entries(details || {}).map(([key, value]) =>
        `${key}=${String(value).replace(/[\r\n,\[\]]/g, " ")}`);
};

const formatError = (error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return message.substring(0, 512);
};

export const logMobileInputEvent = (
    stage: string,
    event?: TMobileInputEvent,
    details?: Record<string, unknown>,
) => {
    if (!window.JSAndroid?.logInputEvent) {
        return;
    }
    const target = event?.target instanceof Element ? event.target : undefined;
    const point = getEventPoint(event);
    const hitTarget = point ? document.elementFromPoint(point.clientX, point.clientY) : undefined;
    const rect = target?.getBoundingClientRect();
    const pointerEvent = event as PointerEvent | undefined;
    const touchEvent = event as TouchEvent | undefined;
    queueLog([
        `issue=18985 stage=${stage}`,
        `elapsed=${Math.round(performance.now())}`,
        event ? `type=${event.type}` : "type=none",
        event ? `trusted=${event.isTrusted}` : "trusted=unavailable",
        event ? `cancelable=${event.cancelable}` : "cancelable=unavailable",
        event ? `defaultPrevented=${event.defaultPrevented}` : "defaultPrevented=unavailable",
        pointerEvent?.pointerType ? `pointerType=${pointerEvent.pointerType}` : "pointerType=unavailable",
        typeof pointerEvent?.buttons === "number" ? `buttons=${pointerEvent.buttons}` : "buttons=unavailable",
        event && "touches" in event ? `touches=${touchEvent.touches.length}` : "touches=unavailable",
        point ? `client=${Math.round(point.clientX)},${Math.round(point.clientY)}` : "client=unavailable",
        `target=${describeElement(target)}`,
        `hit=${describeElement(hitTarget)}`,
        rect ? `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}` :
            "rect=unavailable",
        ...getLayoutDetails(),
        ...formatExtraDetails(details),
    ].join(", "));
};

export const initMobileInputEventLogging = () => {
    if (initialized || !window.JSAndroid?.logInputEvent) {
        return;
    }
    initialized = true;
    const logCapturedEvent = (event: Event) => {
        const target = event.target instanceof Element ? event.target : undefined;
        if (target?.closest(TRACKED_INPUT_SELECTOR)) {
            logMobileInputEvent("capture", event as TMobileInputEvent);
        }
    };
    ["pointerdown", "pointerup", "touchstart", "touchend", "click"].forEach(type => {
        document.addEventListener(type, logCapturedEvent, {capture: true, passive: true});
    });
    window.matchMedia("(orientation: portrait)").addEventListener("change", (event) => {
        logMobileInputEvent("orientation-change", undefined, {portrait: event.matches});
    });
    window.addEventListener("resize", () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
            logMobileInputEvent("resize");
        }, 200);
    });
    window.addEventListener("error", (event) => {
        logMobileInputEvent("window-error", undefined, {
            error: formatError(event.error || event.message),
            source: event.filename?.split("/").pop() || "unavailable",
            line: event.lineno,
            column: event.colno,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        logMobileInputEvent("unhandled-rejection", undefined, {error: formatError(event.reason)});
    });
    logMobileInputEvent("init");
};
