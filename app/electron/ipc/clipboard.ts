// `siyuan-get` 的剪贴板命令。原生格式（公式、Office、WPS）属于本机机密，
// 只有在剪贴板纯文本与请求方提供的一致时才读取。
import * as electron from "electron";
import {beginRichClipboard, cancelRichClipboard, completeRichClipboard} from "./richClipboard";
import {
    getClipboardFormats, normalizeClipboardText, parseClipboardFilePaths, rawFormatType, readClipboardBuffer,
    readClipboardText,
} from "./clipboardFormat";
import type {GetHandler, GetRequest} from "./getContract";

const MAX_NATIVE_CLIPBOARD_BYTES = 8 * 1024 * 1024;

const readRichClipboardText: GetHandler = async ({data}) =>
    readClipboardText(await electron.clipboard.read(), rawFormatType(data.format as string));

const readClipboardFiles: GetHandler = async () =>
    parseClipboardFilePaths(await readClipboardText(await electron.clipboard.read(), "text/uri-list"));

const guardClipboardSnapshot = async (data: GetRequest): Promise<{ok: boolean; items: electron.ClipboardItem[]}> => {
    const items = await electron.clipboard.read();
    if (typeof data.text !== "string" ||
        normalizeClipboardText(await readClipboardText(items, "text/plain")) !== normalizeClipboardText(data.text)) {
        return {ok: false, items};
    }
    return {ok: true, items};
};

const readMathML: GetHandler = async ({data}) => {
    const snapshot = await guardClipboardSnapshot(data);
    if (!snapshot.ok) {
        return "";
    }
    const formats = getClipboardFormats(snapshot.items).filter((format: string) =>
        /^mathml(?: presentation)?$/i.test(format));
    formats.push("MathML", "MathML Presentation");
    // 按原生格式读取 UTF-16 编码的 Office 公式。
    for (const format of new Set(formats)) {
        const buffer = await readClipboardBuffer(snapshot.items, rawFormatType(format));
        if (buffer.length === 0 || buffer.length > 1024 * 1024 || buffer.length % 2 !== 0) {
            continue;
        }
        const mathML = buffer.toString("utf16le")
            .replace(/^\uFEFF/, "")
            .replace(/\0+$/, "")
            .trim();
        if (/<(?:[A-Za-z_][\w.-]*:)?math(?:\s|>)/i.test(mathML)) {
            return mathML;
        }
    }
    return "";
};

const readOffice: GetHandler = async ({data}) => {
    const snapshot = await guardClipboardSnapshot(data);
    if (!snapshot.ok) {
        return "";
    }
    const buffer = await readClipboardBuffer(snapshot.items, rawFormatType("Embed Source"));
    const compoundFileSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    if (buffer.length === 0 || buffer.length > MAX_NATIVE_CLIPBOARD_BYTES ||
        !buffer.subarray(0, compoundFileSignature.length).equals(compoundFileSignature)) {
        return "";
    }
    return buffer.toString("base64");
};

const readWPS: GetHandler = async ({data}) => {
    const snapshot = await guardClipboardSnapshot(data);
    if (!snapshot.ok) {
        return "";
    }
    const formats = getClipboardFormats(snapshot.items).filter((format: string) =>
        /kingsoft.*wps.*format/i.test(format));
    formats.push("Kingsoft WPS Format");
    for (let version = 6; version <= 20; version++) {
        formats.push(`Kingsoft WPS ${version}.0 Format`);
    }
    // 按原生格式读取 WPS 的压缩包数据。
    for (const format of new Set(formats)) {
        const buffer = await readClipboardBuffer(snapshot.items, rawFormatType(format));
        if (buffer.length <= MAX_NATIVE_CLIPBOARD_BYTES && buffer[0] === 0x50 && buffer[1] === 0x4b) {
            return buffer.toString("base64");
        }
    }
    return "";
};

const clipboardHandlers: Record<string, GetHandler> = {
    "clipboardRead": readRichClipboardText,
    "clipboardReadFiles": readClipboardFiles,
    "clipboardReadMathML": readMathML,
    "clipboardReadOffice": readOffice,
    "clipboardReadWPS": readWPS,
    "beginRichClipboard": ({event, data}) => beginRichClipboard(event.sender.id, data),
    "completeRichClipboard": ({event, data}) => completeRichClipboard(event.sender.id, data),
    "cancelRichClipboard": ({event, data}) => cancelRichClipboard(event.sender.id, data.token),
};

export {clipboardHandlers};
