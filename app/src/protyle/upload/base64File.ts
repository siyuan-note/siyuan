interface IBase64ImageFormat {
    extension: string;
    mime: string;
}

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
    const text = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, "").trimStart();
    if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) {
        return {extension: "svg", mime: "image/svg+xml"};
    }
};

const getBase64DecodedSize = (base64: string) => {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor(base64.length * 3 / 4) - padding;
};

export const createBase64ImageFile = (source: string, name: string, maxBytes?: number) => {
    const separator = source.indexOf(",");
    if (separator < 0) {
        return;
    }
    const mimeMatch = source.substring(0, separator).match(/^data:([^;,]+)(?:;[^,]*)?;base64$/i);
    if (!mimeMatch) {
        return;
    }
    try {
        const base64 = source.substring(separator + 1).replace(/%0A/gi, "\n").replace(/\s/g, "");
        if (maxBytes !== undefined && getBase64DecodedSize(base64) > maxBytes) {
            return;
        }
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
        console.error(error);
    }
};
