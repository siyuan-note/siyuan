export const AV_MAP_PROTOCOL_VERSION = 1;
export const AV_MAP_MAX_POINTS = 10000;
export const AV_MAP_MERCATOR_MAX_LATITUDE = 85.0511287798066;

export type AVMapProvider = "openfreemap";
export type AVMapTheme = "light" | "dark";
export type AVMapLoadErrorCode = "sdkScriptLoadFailed" | "sdkGlobalMissing" |
    "mapCreationFailed" | "mapReadyTimeout";
export type AVMapHostErrorCode = "hostLimitReached" | "hostSetupFailed" | "hostAttachFailed" |
    "hostDocumentLoadFailed" | "hostDocumentLoadTimeout" | "hostDocumentReloaded" | "hostDocumentMismatch" |
    "hostRendererGone" | "hostDestroyed" | "hostPortSetupFailed" | "hostPortClosed" | "hostBootstrapFailed" |
    "hostBootstrapTimeout" | "hostSDKTimeout" | "hostOperationFailed" | "hostCreateRejected" |
    "hostCreateInvalidResponse" | "hostReadyTimeout" | "hostOwnerSetupFailed";
export type AVMapErrorCode = "unsupportedEnvironment" | "invalidConfiguration" |
    "hostUnavailable" | "sdkUnavailable" | "mapUnavailable" | AVMapLoadErrorCode | AVMapHostErrorCode;

const mapHostErrorCodes = new Set<AVMapHostErrorCode>([
    "hostLimitReached", "hostSetupFailed", "hostAttachFailed", "hostDocumentLoadFailed", "hostDocumentLoadTimeout",
    "hostDocumentReloaded", "hostDocumentMismatch", "hostRendererGone", "hostDestroyed", "hostPortSetupFailed",
    "hostPortClosed", "hostBootstrapFailed", "hostBootstrapTimeout", "hostSDKTimeout", "hostOperationFailed",
    "hostCreateRejected", "hostCreateInvalidResponse", "hostReadyTimeout", "hostOwnerSetupFailed",
]);
export const isAVMapHostErrorCode = (value: unknown): value is AVMapHostErrorCode =>
    typeof value === "string" && mapHostErrorCodes.has(value as AVMapHostErrorCode);

const mapLoadErrorCodes = new Set<AVMapLoadErrorCode>([
    "sdkScriptLoadFailed", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout",
]);
const isAVMapLoadErrorCode = (value: unknown): value is AVMapLoadErrorCode =>
    typeof value === "string" && mapLoadErrorCodes.has(value as AVMapLoadErrorCode);

// 内部加载阶段只保留固定错误码，不保存 SDK 原始异常、地址或凭据。
export class AVMapLoadError extends Error {
    constructor(readonly code: AVMapLoadErrorCode) {
        super("Map loading failed");
    }
}

export const getAVMapLoadErrorCode = (error: unknown): AVMapLoadErrorCode | undefined =>
    error instanceof AVMapLoadError && isAVMapLoadErrorCode(error.code) ? error.code : undefined;

// 父页面仅展示固定官方署名链接，不接受隔离框架返回的 URL 或 HTML。
export const AV_MAP_ATTRIBUTION_LINKS: Readonly<Record<AVMapProvider, ReadonlyArray<{label: string; href: string}>>> = {
    openfreemap: [
        {label: "OpenFreeMap", href: "https://openfreemap.org"},
        {label: "© OpenMapTiles", href: "https://www.openmaptiles.org/"},
        {label: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright"},
    ],
};

export interface AVMapPoint {
    id: string;
    longitude: number;
    latitude: number;
}

interface AVMapEnvelope {
    version: 1;
    instanceID: string;
}

export interface AVMapInit extends AVMapEnvelope {
    type: "init";
    provider: AVMapProvider;
    theme: AVMapTheme;
}

export type AVMapCommand = AVMapInit |
    (AVMapEnvelope & {type: "setPoints"; revision: number; points: AVMapPoint[]}) |
    (AVMapEnvelope & {type: "theme"; theme: AVMapTheme}) |
    (AVMapEnvelope & {type: "fit" | "resize" | "destroy"});

export type AVMapReply = (AVMapEnvelope & {type: "ready"}) |
    (AVMapEnvelope & {type: "markerClick"; id: string; revision: number}) |
    (AVMapEnvelope & {type: "error"; code: AVMapErrorCode});

export const isAVMapProvider = (value: unknown): value is AVMapProvider =>
    value === "openfreemap";

export const isAVMapTheme = (value: unknown): value is AVMapTheme => value === "light" || value === "dark";

export const isAVMapIdentifier = (value: unknown): value is string =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export const isAVMapRevision = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isAVMapProjectionSupported = (latitude: number): boolean =>
    Number.isFinite(latitude) && Math.abs(latitude) <= AV_MAP_MERCATOR_MAX_LATITUDE;

// 主界面和隔离宿主分别调用白名单复制，不传输名称、原始输入或完整记录。
export const sanitizeAVMapPoints = (input: unknown): AVMapPoint[] => {
    if (!Array.isArray(input)) {
        return [];
    }
    const ids = new Set<string>();
    const result: AVMapPoint[] = [];
    input.slice(0, AV_MAP_MAX_POINTS).forEach((point) => {
        if (!point || typeof point !== "object" || "coordinateSystem" in point || !isAVMapIdentifier(point.id) || ids.has(point.id) ||
            typeof point.longitude !== "number" || !Number.isFinite(point.longitude) ||
            point.longitude < -180 || point.longitude > 180 ||
            typeof point.latitude !== "number" || !Number.isFinite(point.latitude) ||
            point.latitude < -90 || point.latitude > 90 ||
            !isAVMapProjectionSupported(point.latitude)) {
            return;
        }
        ids.add(point.id);
        result.push({id: point.id, longitude: point.longitude, latitude: point.latitude});
    });
    return result;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export const parseAVMapCommand = (value: unknown, instanceID: string, provider?: AVMapProvider): AVMapCommand | undefined => {
    const input = asRecord(value);
    if (!input || input.version !== AV_MAP_PROTOCOL_VERSION || input.instanceID !== instanceID) {
        return;
    }
    const envelope = {version: AV_MAP_PROTOCOL_VERSION, instanceID} as const;
    switch (input.type) {
        case "init":
            if (!isAVMapProvider(input.provider) || !isAVMapTheme(input.theme)) {
                return;
            }
            return {...envelope, type: "init", provider: input.provider, theme: input.theme};
        case "setPoints":
            if (!provider || !isAVMapRevision(input.revision) || !Array.isArray(input.points)) {
                return;
            }
            return {...envelope, type: "setPoints", revision: input.revision,
                points: sanitizeAVMapPoints(input.points)};
        case "theme":
            return isAVMapTheme(input.theme) ? {...envelope, type: "theme", theme: input.theme} : undefined;
        case "fit":
        case "resize":
        case "destroy":
            return {...envelope, type: input.type};
    }
};

export const parseAVMapReply = (value: unknown, instanceID: string): AVMapReply | undefined => {
    const input = asRecord(value);
    if (!input || input.version !== AV_MAP_PROTOCOL_VERSION || input.instanceID !== instanceID) {
        return;
    }
    const envelope = {version: AV_MAP_PROTOCOL_VERSION, instanceID} as const;
    if (input.type === "ready") {
        return {...envelope, type: "ready"};
    }
    if (input.type === "markerClick" && isAVMapIdentifier(input.id) && isAVMapRevision(input.revision)) {
        return {...envelope, type: "markerClick", id: input.id, revision: input.revision};
    }
    if (input.type === "error" && (["unsupportedEnvironment", "invalidConfiguration",
        "hostUnavailable", "sdkUnavailable", "mapUnavailable"].includes(input.code as string) ||
        isAVMapLoadErrorCode(input.code) || isAVMapHostErrorCode(input.code))) {
        return {...envelope, type: "error", code: input.code as AVMapErrorCode};
    }
};

export const isAVMapHandshake = (value: unknown, type: "hello" | "connect", instanceID: string, nonce: string): boolean => {
    const input = asRecord(value);
    return !!input && input.type === type && input.version === AV_MAP_PROTOCOL_VERSION &&
        input.instanceID === instanceID && input.nonce === nonce;
};
