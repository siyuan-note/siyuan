const coordinateSystems = new Set(["unknown", "wgs84", "gcj02", "bd09"]);
const decimalCoordinate = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const coordinateInputNumber = "[+-]?(?:(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?|Infinity|NaN)";
const coordinateInput = new RegExp(`^${coordinateInputNumber}$`, "i");
const canonicalInput = new RegExp(`(?:^|;\\s*)${coordinateInputNumber}\\s*,\\s*${coordinateInputNumber}\\s*\\[[^\\]]+\\]\\s*$`, "i");

export const isAVLocationCoordinateSystem = (value: string): value is IAVCellLocationValue["coordinateSystem"] => {
    return coordinateSystems.has(value);
};

export const hasAVLocationCoordinates = (location?: IAVCellLocationValue) => {
    return typeof location?.latitude === "number" && Number.isFinite(location.latitude) &&
        location.latitude >= -90 && location.latitude <= 90 &&
        typeof location.longitude === "number" && Number.isFinite(location.longitude) &&
        location.longitude >= -180 && location.longitude <= 180;
};

export const validateAVLocation = (location?: IAVCellLocationValue) => {
    if (!location) {
        return true;
    }
    if (location.coordinateSystem !== undefined && location.coordinateSystem !== "" &&
        !isAVLocationCoordinateSystem(location.coordinateSystem)) {
        return false;
    }
    if ((location.name !== undefined && typeof location.name !== "string") ||
        (location.originalInput !== undefined && typeof location.originalInput !== "string")) {
        return false;
    }
    return (location.latitude == null && location.longitude == null) || hasAVLocationCoordinates(location);
};

export const isAVLocationEmpty = (location?: IAVCellLocationValue) => {
    return !location?.name?.trim() && !hasAVLocationCoordinates(location);
};

export const formatAVLocationCoordinate = (value: number) => {
    const text = String(value);
    if (!text.includes("e")) {
        return text;
    }
    const negative = text.startsWith("-");
    const [mantissa, exponent] = (negative ? text.slice(1) : text).split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    const digits = whole + fraction;
    const position = whole.length + Number(exponent);
    const expanded = position <= 0 ? "0." + "0".repeat(-position) + digits :
        position >= digits.length ? digits + "0".repeat(position - digits.length) :
            digits.slice(0, position) + "." + digits.slice(position);
    return (negative ? "-" : "") + expanded;
};

export const getAVLocationText = (location?: IAVCellLocationValue) => {
    const name = location?.name?.trim() || "";
    if (!hasAVLocationCoordinates(location)) {
        return name;
    }
    const system = location.coordinateSystem || "unknown";
    const label = {unknown: "unknown", wgs84: "WGS84", gcj02: "GCJ-02", bd09: "BD-09"}[system] || "unknown";
    return `${name ? name + "; " : ""}${formatAVLocationCoordinate(location.latitude)}, ${formatAVLocationCoordinate(location.longitude)} [${label}]`;
};

// 事务按字段合并，删除旧坐标或来源时必须显式发送空值。
export const createAVLocationReplacement = (location?: IAVCellLocationValue): IAVCellLocationValue => ({
    name: location?.name?.trim() || "",
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    coordinateSystem: location?.coordinateSystem || "unknown",
    originalInput: location?.originalInput ?? "",
});

export const isAVLocationCoordinateInput = (text: string) => {
    const trimmed = text.trim();
    const unwrapped = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
    const parts = unwrapped.split(",").map(part => part.trim());
    return (parts.length > 1 && parts.some(part => part !== "") &&
        parts.every(part => part === "" || coordinateInput.test(part))) || canonicalInput.test(text);
};

// 普通粘贴只记录地点名称；坐标文本必须使用明确标注顺序的导入入口。
export const createAVLocationFromText = (text: string): IAVCellLocationValue => {
    if (isAVLocationCoordinateInput(text)) {
        throw new Error("Location coordinates require explicit latitude, longitude input");
    }
    return createAVLocationReplacement({name: text.trim(), originalInput: text});
};

export const parseAVLocationCoordinate = (text: string) => {
    const value = text.trim();
    if (!decimalCoordinate.test(value)) {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

// 只按用户明确选择的顺序解析，不根据范围猜测顺序或解析地图服务链接。
export const parseAVLocationCoordinates = (text: string,
                                          coordinateSystem: IAVCellLocationValue["coordinateSystem"] = "unknown",
                                          order: "latitudeLongitude" | "longitudeLatitude" = "latitudeLongitude"):
    IAVCellLocationValue | undefined => {
    coordinateSystem = coordinateSystem || "unknown";
    const trimmed = text.trim();
    const unwrapped = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
    const parts = unwrapped.split(",");
    if (parts.length !== 2 || !isAVLocationCoordinateSystem(coordinateSystem)) {
        return undefined;
    }
    const latitude = parseAVLocationCoordinate(parts[order === "longitudeLatitude" ? 1 : 0]);
    const longitude = parseAVLocationCoordinate(parts[order === "longitudeLatitude" ? 0 : 1]);
    const value = {latitude, longitude, coordinateSystem, originalInput: text};
    return hasAVLocationCoordinates(value) ? value : undefined;
};

// 原始输入仅为来源记录，不参与值的语义比较。
export const areAVLocationsEqual = (left?: IAVCellLocationValue, right?: IAVCellLocationValue) => {
    return (left?.name?.trim() || "") === (right?.name?.trim() || "") &&
        (left?.latitude ?? null) === (right?.latitude ?? null) &&
        (left?.longitude ?? null) === (right?.longitude ?? null) &&
        (left?.coordinateSystem || "unknown") === (right?.coordinateSystem || "unknown");
};
