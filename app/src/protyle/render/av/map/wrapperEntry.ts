import {isAVMapBootstrapMessage, isAVMapLoadErrorCode, isAVMapProvider} from "./protocol";
import {AV_MAP_BOOTSTRAP_TIMEOUT} from "./loadingBudget";

// 可信 wrapper 不加载 SDK、不处理记录或凭证，只把一次业务端口交给固定 opaque 子框架。
export const connectAVMapWrapper = (scope: Window) => {
    const [instanceID, nonce] = scope.location.hash.slice(1).split(":");
    const provider = new URLSearchParams(scope.location.search).get("provider");
    if (scope.parent === scope || !/^https?:$/.test(scope.location.protocol) ||
        !/^[a-f0-9]{48}$/.test(instanceID || "") || !/^[a-f0-9]{48}$/.test(nonce || "") || !isAVMapProvider(provider)) {
        return;
    }
    const envelope = {version: 1, instanceID, nonce};
    let child: HTMLIFrameElement;
    let nativeBoundary = false;
    let booted = false;
    let ready = false;
    let connected = false;
    let closed = false;
    const cleanup = () => {
        closed = true;
        scope.clearTimeout(timer);
        scope.removeEventListener("message", onMessage);
        child?.remove();
    };
    const onMessage = (event: MessageEvent) => {
        if (closed) {
            return;
        }
        if (event.source === scope.parent && event.origin === scope.location.origin) {
            if (!child && event.ports.length === 0 && isAVMapBootstrapMessage(event.data, "prepare", instanceID, nonce)) {
                nativeBoundary = event.data.nativeBoundary === true;
                child = scope.document.createElement("iframe");
                child.setAttribute("sandbox", "allow-scripts");
                child.setAttribute("allow", "geolocation 'none'; camera 'none'; microphone 'none'; clipboard-read 'none'; clipboard-write 'none'");
                if ("credentialless" in child) {
                    (child as HTMLIFrameElement & {credentialless: boolean}).credentialless = true;
                }
                child.referrerPolicy = "strict-origin-when-cross-origin";
                child.style.cssText = "width:100%;height:100%;border:0;display:block";
                child.src = `/stage/map/index.html?provider=${provider}#${instanceID}:${nonce}`;
                scope.document.body.appendChild(child);
            } else if (ready && !connected && event.ports.length === 1 &&
                isAVMapBootstrapMessage(event.data, "connect", instanceID, nonce)) {
                connected = true;
                child.contentWindow.postMessage({...envelope, type: "connect"}, "*", [event.ports[0]]);
                scope.removeEventListener("message", onMessage);
                scope.clearTimeout(timer);
            }
            return;
        }
        if (!child || event.source !== child.contentWindow || event.origin !== "null" || event.ports.length !== 0) {
            return;
        }
        if (!booted && isAVMapBootstrapMessage(event.data, "hello", instanceID, nonce)) {
            booted = true;
            child.contentWindow.postMessage({...envelope, type: "prepare", nativeBoundary}, "*");
        } else if (booted && !ready && isAVMapBootstrapMessage(event.data, "bootstrapReady", instanceID, nonce)) {
            ready = true;
            scope.parent.postMessage({...envelope, type: "bootstrapReady"}, scope.location.origin);
        } else if (booted && isAVMapBootstrapMessage(event.data, "bootstrapError", instanceID, nonce)) {
            const code = isAVMapLoadErrorCode(event.data.code) ? event.data.code : "hostBootstrapFailed";
            scope.parent.postMessage({...envelope, type: "bootstrapError", code}, scope.location.origin);
            cleanup();
        }
    };
    const timer = scope.setTimeout(cleanup, AV_MAP_BOOTSTRAP_TIMEOUT);
    scope.addEventListener("message", onMessage);
    scope.addEventListener("pagehide", cleanup, {once: true});
    scope.parent.postMessage({...envelope, type: "wrapperHello"}, scope.location.origin);
};

if (typeof window !== "undefined") {
    connectAVMapWrapper(window);
}
