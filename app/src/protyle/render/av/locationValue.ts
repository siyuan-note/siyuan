const decimalCoordinateNumber = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const decimalCoordinate = new RegExp(`^${decimalCoordinateNumber}$`);
const coordinateInput = /^[+-]*(?:[\d.]+(?:e[+-]*\d*)?|Infinity|NaN|0[xob][\da-f]*)?$/i;
const canonicalInput = new RegExp(`^(?:([\\s\\S]+);\\s*)?(${decimalCoordinateNumber})\\s*,\\s*(${decimalCoordinateNumber})(\\s*\\[WGS84\\])?$`);
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
    // 名称可以包含分号；坐标候选采用更宽的语法，避免将格式错误或其他坐标系保存成名称。
    const isCoordinateSuffix = (value: string) => {
        const suffix = value.slice(value.lastIndexOf(";") + 1).trim();
        const unwrapped = suffix.replace(/^[([]/, "");
        const coordinates = unwrapped.replace(/\[[\s\S]*$/, "").trim().replace(/[)\]]$/, "");
        const parts = coordinates.split(",").map(part => part.trim());
        return parts.length > 1 && parts.every(part => coordinateInput.test(part));
    };
    // 无效坐标系标签中的分号、逗号也不应被识别为名称或另一组坐标。
    return isCoordinateSuffix(text) || isCoordinateSuffix(text.replace(/\[[^\]]*(?:\]|$)/g, "["));
};

// 文本交换固定为纬度、经度；只接受十进制 WGS84，不推断顺序或转换坐标系。
export const createAVLocationFromText = (text: string): IAVCellLocationValue => {
    const coordinates = canonicalInput.exec(text.trim());
    if (coordinates && (coordinates[1] === undefined || (coordinates[1].trim() && coordinates[4]))) {
        return createAVLocationReplacement({
            name: coordinates[1]?.trim() || "",
            latitude: Number(coordinates[2]),
            longitude: Number(coordinates[3]),
            originalInput: text,
        });
    }
    if (isAVLocationCoordinateInput(text)) {
        throw new Error("Invalid WGS84 location coordinate text");
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
