const getBase64ImageExtension = (mime: string) => ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
}[mime] || "png");

export const createBase64ImageFile = (source: string, name: string) => {
    const separator = source.indexOf(",");
    if (separator < 0) {
        return;
    }
    const mimeMatch = source.substring(0, separator).match(/^data:([^;,]+)(?:;[^,]*)?;base64$/i);
    if (!mimeMatch) {
        return;
    }
    try {
        const mime = mimeMatch[1].toLowerCase();
        const binary = atob(source.substring(separator + 1));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new File([bytes], `${name}.${getBase64ImageExtension(mime)}`, {type: mime});
    } catch (error) {
        console.error(error);
    }
};
