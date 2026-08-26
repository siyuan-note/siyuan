interface IBase64ImageFormat {
    extension: string;
    mime: string;
}

export const BASE64_IMAGE_ITEM_MAX_BYTES = 32 * 1024 * 1024;
export const BASE64_IMAGE_BATCH_MAX_BYTES = 64 * 1024 * 1024;

export type TBase64ImageSizeLimitScope = "item" | "batch";

export class Base64ImageSizeLimitError extends Error {
    readonly code = "BASE64_IMAGE_SIZE_LIMIT";

    constructor(readonly scope: TBase64ImageSizeLimitScope, readonly actualBytes: number, readonly maxBytes: number) {
        super(`Base64 image ${scope} size ${actualBytes} exceeds ${maxBytes} bytes`);
        this.name = "Base64ImageSizeLimitError";
    }
}

export const isBase64ImageSizeLimitError = (error: unknown): error is Base64ImageSizeLimitError =>
    error instanceof Base64ImageSizeLimitError;

export const assertBase64ImageItemSize = (actualBytes: number, maxBytes?: number) => {
    const itemMaxBytes = Math.min(maxBytes ?? BASE64_IMAGE_ITEM_MAX_BYTES, BASE64_IMAGE_ITEM_MAX_BYTES);
    if (actualBytes > itemMaxBytes) {
        throw new Base64ImageSizeLimitError("item", actualBytes, itemMaxBytes);
    }
};

export const addBase64ImageBatchSize = (currentBytes: number, fileBytes: number) => {
    const totalBytes = currentBytes + fileBytes;
    if (totalBytes > BASE64_IMAGE_BATCH_MAX_BYTES) {
        throw new Base64ImageSizeLimitError("batch", totalBytes, BASE64_IMAGE_BATCH_MAX_BYTES);
    }
    return totalBytes;
};

const startsWith = (bytes: Uint8Array, signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);

const detectBase64ImageFormat = (bytes: Uint8Array): IBase64ImageFormat | undefined => {
    if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
        return {extension: "png", mime: "image/png"};
    }
    if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) {
        return {extension: "jpg", mime: "image/jpeg"};
    }
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
        return {extension: "gif", mime: "image/gif"};
    }
    if (startsWith(bytes, [0x42, 0x4D])) {
        return {extension: "bmp", mime: "image/bmp"};
    }
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
        return {extension: "webp", mime: "image/webp"};
    }
    const text = new TextDecoder().decode(bytes.subarray(0, 64 * 1024)).replace(/^\uFEFF/, "");
    const root = text.replace(/^(?:(?:\s+)|(?:<\?xml[\s\S]*?\?>)|(?:<!--[\s\S]*?-->)|(?:<!DOCTYPE[\s\S]*?>))*/i, "");
    if (/^<svg(?:\s|>)/i.test(root)) {
        return {extension: "svg", mime: "image/svg+xml"};
    }
};

const getBase64Data = (source: string) => {
    const separator = source.indexOf(",");
    if (separator < 0 || !/^data:([^;,]+)(?:;[^,]*)?;base64$/i.test(source.substring(0, separator))) {
        return;
    }
    return source.substring(separator + 1);
};

export const getBase64ImageDecodedSize = (source: string) => {
    const data = getBase64Data(source);
    if (data === undefined) {
        return;
    }
    let encodedLength = 0;
    let lastCharacter = "";
    let penultimateCharacter = "";
    for (let index = 0; index < data.length; index++) {
        const code = data.charCodeAt(index);
        if (code === 0x25 && data[index + 1] === "0" && data[index + 2]?.toUpperCase() === "A") {
            index += 2;
            continue;
        }
        if (code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D || code === 0x20) {
            continue;
        }
        encodedLength++;
        penultimateCharacter = lastCharacter;
        lastCharacter = data[index];
    }
    const padding = lastCharacter === "=" ? penultimateCharacter === "=" ? 2 : 1 : 0;
    return Math.floor(encodedLength * 3 / 4) - padding;
};

export const createBase64ImageFile = (source: string, name: string, maxBytes?: number) => {
    const base64Data = getBase64Data(source);
    if (base64Data === undefined) {
        return;
    }
    try {
        const decodedSize = getBase64ImageDecodedSize(source);
        if (decodedSize === undefined) {
            return;
        }
        assertBase64ImageItemSize(decodedSize, maxBytes);
        const base64 = base64Data.replace(/%0A/gi, "\n").replace(/\s/g, "");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        const format = detectBase64ImageFormat(bytes);
        if (!format) {
            return;
        }
        return new File([bytes], `${name}.${format.extension}`, {type: format.mime});
    } catch (error) {
        if (isBase64ImageSizeLimitError(error)) {
            throw error;
        }
        console.error(error);
    }
};
