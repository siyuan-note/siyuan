const decimalCoordinate = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const coordinateInputNumber = "[+-]?(?:(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?|Infinity|NaN)";
const coordinateInput = new RegExp(`^${coordinateInputNumber}$`, "i");
const canonicalInput = new RegExp(`(?:^|;\\s*)${coordinateInputNumber}\\s*,\\s*${coordinateInputNumber}\\s*\\[[^\\]]+\\]\\s*$`, "i");
const locationFields = new Set(["name", "latitude", "longitude", "originalInput"]);

const isLocationObject = (location: unknown): location is IAVCellLocationValue =>
    !!location && typeof location === "object" && !Array.isArray(location) &&
    Object.keys(location).every(key => locationFields.has(key));

export const hasAVLocationCoordinates = (location?: IAVCellLocationValue) => {
    return isLocationObject(location) &&
        typeof location.latitude === "number" && Number.isFinite(location.latitude) &&
        location.latitude >= -90 && location.latitude <= 90 &&
        typeof location.longitude === "number" && Number.isFinite(location.longitude) &&
        location.longitude >= -180 && location.longitude <= 180;
};

export const validateAVLocation = (location?: IAVCellLocationValue) => {
    if (location == null) {
        return true;
    }
    if (!isLocationObject(location)) {
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

const formatAVLocationText = (location?: IAVCellLocationValue, longitudeFirst = false) => {
    const name = location?.name?.trim() || "";
    if (!hasAVLocationCoordinates(location)) {
        return name;
    }
    const coordinates = longitudeFirst ? [location.longitude, location.latitude] : [location.latitude, location.longitude];
    const text = coordinates.map(formatAVLocationCoordinate).join(", ");
    return longitudeFirst ? `${name ? name + " " : ""}${text}` : `${name ? name + "; " : ""}${text} [WGS84]`;
};

// 复制、类型转换和内核导出保持既有的纬度、经度文本契约。
export const getAVLocationText = (location?: IAVCellLocationValue) => formatAVLocationText(location);

// 界面与编辑器统一按经度、纬度显示，不改变持久化值或文本交换格式。
export const getAVLocationDisplayText = (location?: IAVCellLocationValue) => formatAVLocationText(location, true);

// 事务按字段合并，删除旧坐标或来源时必须显式发送空值。
export const createAVLocationReplacement = (location?: IAVCellLocationValue): IAVCellLocationValue => {
    if (!validateAVLocation(location)) {
        throw new Error("Invalid WGS84 location");
    }
    return {
        name: location?.name?.trim() || "",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        originalInput: location?.originalInput ?? "",
    };
};

export const isAVLocationCoordinateInput = (text: string) => {
    const trimmed = text.trim();
    const unwrapped = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
    const parts = unwrapped.split(",").map(part => part.trim());
    return (parts.length > 1 && parts.some(part => part !== "") &&
        parts.every(part => part === "" || coordinateInput.test(part))) || canonicalInput.test(text);
};

// 普通粘贴只记录地点名称；坐标必须在编辑器中按具名字段输入。
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

// 原始输入仅为来源记录，不参与值的语义比较。
export const areAVLocationsEqual = (left?: IAVCellLocationValue, right?: IAVCellLocationValue) => {
    return (left?.name?.trim() || "") === (right?.name?.trim() || "") &&
        (left?.latitude ?? null) === (right?.latitude ?? null) &&
        (left?.longitude ?? null) === (right?.longitude ?? null);
};
