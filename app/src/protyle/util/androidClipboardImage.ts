interface AndroidClipboardImageBridge {
    postMessage(message: string): void;
    onmessage?: (event: {data: string}) => void;
}

const imageExtensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};
const maxImageBytes = 8 * 1024 * 1024;
const maxBase64Length = Math.ceil(maxImageBytes / 3) * 4;
let requestSequence = 0;
let requestPending = false;

export const getAndroidClipboardImageBridge = (host: Window | {siyuanClipboardImageNative?: AndroidClipboardImageBridge}) => {
    const bridge = (host as {siyuanClipboardImageNative?: AndroidClipboardImageBridge}).siyuanClipboardImageNative;
    return typeof bridge?.postMessage === "function" ? bridge : undefined;
};

const decodeClipboardImage = (mimeType: unknown, data: unknown) => {
    if (typeof mimeType !== "string" || !Object.hasOwn(imageExtensions, mimeType) ||
        typeof data !== "string" || !data || data.length > maxBase64Length || data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        return;
    }
    const bytes = atob(data);
    if (!bytes.length || bytes.length > maxImageBytes) {
        return;
    }
    return new File([Uint8Array.from(bytes, byte => byte.charCodeAt(0))], `image.${imageExtensions[mimeType]}`, {type: mimeType});
};

export const readAndroidClipboardImage = (bridge: AndroidClipboardImageBridge, timeout = 5000): Promise<File | undefined> => {
    if (!bridge || requestPending) {
        return Promise.resolve(undefined);
    }
    requestPending = true;
    const id = `${Date.now().toString(36)}-${++requestSequence}`;
    return new Promise(resolve => {
        let active = true;
        const finish = (file?: File) => {
            if (!active) {
                return;
            }
            active = false;
            clearTimeout(timer);
            requestPending = false;
            resolve(file);
        };
        const timer = setTimeout(finish, timeout);
        try {
            bridge.onmessage = event => {
                if (!active) {
                    return;
                }
                let reply: {id?: unknown; mimeType?: unknown; data?: unknown};
                try {
                    reply = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (reply?.id !== id) {
                    return;
                }
                try {
                    finish(decodeClipboardImage(reply.mimeType, reply.data));
                } catch {
                    finish();
                }
            };
            bridge.postMessage(JSON.stringify({id, action: "readClipboardImage"}));
        } catch {
            finish();
        }
    });
};

export const getAndroidClipboardPaste = (clipboard: Pick<DataTransfer, "files" | "types" | "getData">, trusted: boolean,
                                         textPlain: string, hasOtherContent: boolean) => {
    const allFiles = Array.from(clipboard.files);
    const files = allFiles.filter(file => file.size !== 0 || !file.type.startsWith("image/"));
    const types = Array.from(clipboard.types, type => type.toLowerCase());
    const placeholder = trusted && !hasOtherContent && allFiles.length === 1 && files.length === 0 &&
        Object.hasOwn(imageExtensions, allFiles[0].type) && types.includes("image-uri") &&
        types.every(type => type === "files" || type === "text/plain" || type === "image-uri" || type === allFiles[0].type);
    const metadata = placeholder && textPlain.startsWith("content://") && textPlain === clipboard.getData("image-uri");
    return {files, textPlain: metadata ? "" : textPlain, recoverImage: placeholder && (!textPlain || metadata)};
};
