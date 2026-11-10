import * as fs from "node:fs";
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import * as electron from "electron";
import {readClipboardText, normalizeClipboardText} from "./clipboardFormat";

type RichClipboardRequest = {text?: unknown; marker?: unknown; token?: unknown; html?: unknown;
    replacements?: unknown; [key: string]: unknown};

type RichClipboardOperation = {
    token: string;
    senderId: number;
    requestedText: string;
    text: string;
    html: string;
};

// 富文本粘贴需要「先读出原文，再补写文件链接」，两次操作之间剪贴板可能被别处改写。
// 因此只保留最近一次操作，并校验剪贴板内容与发起时的快照完全一致。
let operation: RichClipboardOperation | undefined;
let sequence = 0;

const beginRichClipboard = async (senderId: number, data: RichClipboardRequest): Promise<string | undefined> => {
    operation = undefined;
    const current = ++sequence;
    const items = await electron.clipboard.read();
    const text = await readClipboardText(items, "text/plain");
    const html = await readClipboardText(items, "text/html");
    // 读取期间又有新的粘贴开始，本次结果作废。
    if (current !== sequence) {
        return;
    }
    if (typeof data.text !== "string" || typeof data.marker !== "string" ||
        normalizeClipboardText(text) !== normalizeClipboardText(data.text) ||
        !data.marker || !html.includes(data.marker)) {
        return;
    }

    const token = `${Date.now()}-${sequence}`;
    operation = {
        token,
        senderId,
        requestedText: data.text,
        text,
        html,
    };
    return token;
};

const completeRichClipboard = async (senderId: number, data: RichClipboardRequest): Promise<boolean> => {
    const current = operation;
    if (!current || current.token !== data.token || current.senderId !== senderId) {
        return false;
    }
    const items = await electron.clipboard.read();
    const text = await readClipboardText(items, "text/plain");
    const html = await readClipboardText(items, "text/html");
    // 读取期间又有新的操作开始，本次结果作废。
    if (operation !== current) {
        return false;
    }
    if (current.requestedText !== data.text || text !== current.text ||
        html !== current.html || typeof data.html !== "string" ||
        !Array.isArray(data.replacements) || 1024 < data.replacements.length) {
        operation = undefined;
        return false;
    }

    let nextHTML = data.html;
    for (const replacement of data.replacements as {path?: unknown; placeholder?: unknown}[]) {
        let isFile = false;
        if (replacement && typeof replacement.path === "string" && path.isAbsolute(replacement.path)) {
            try {
                isFile = fs.statSync(replacement.path).isFile();
            } catch {
                isFile = false;
            }
        }
        if (!replacement || typeof replacement.placeholder !== "string" || !replacement.placeholder ||
            !isFile || !nextHTML.includes(replacement.placeholder)) {
            operation = undefined;
            return false;
        }
        const fileURL = pathToFileURL(replacement.path as string).href.replaceAll("&", "&amp;");
        nextHTML = nextHTML.split(replacement.placeholder).join(fileURL);
    }

    operation = undefined;
    await electron.clipboard.write([new electron.ClipboardItem({"text/plain": data.text as string,
        "text/html": nextHTML})]);
    return true;
};

const cancelRichClipboard = (senderId: number, token: unknown): void => {
    if (operation && operation.token === token && operation.senderId === senderId) {
        operation = undefined;
    }
};

export {beginRichClipboard, completeRichClipboard, cancelRichClipboard};
