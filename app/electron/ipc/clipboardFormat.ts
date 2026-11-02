import {fileURLToPath} from "node:url";

// 主进程只依赖读取所需的两个成员，避免绑定 Electron 的剪贴板对象类型。
// getType 的返回值声明为 unknown，因为 Electron 的书签格式会返回 ClipboardBookmark 而非 Blob。
type ClipboardDataItem = {
    types: readonly string[];
    getType: (type: string) => Promise<unknown>;
};

const rawFormatType = (format: string): string =>
    `electron application/osclipboard;format="${format.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const readClipboardBuffer = async (items: ClipboardDataItem[], type: string): Promise<Buffer> => {
    for (const item of items) {
        if (item.types.includes(type)) {
            // 读取的格式都不是书签格式，此处只可能是 Blob。
            const blob = await item.getType(type) as Blob;
            return Buffer.from(await blob.arrayBuffer());
        }
    }
    return Buffer.alloc(0);
};

const readClipboardText = async (items: ClipboardDataItem[], type: string): Promise<string> => {
    return (await readClipboardBuffer(items, type)).toString("utf8");
};

const getClipboardFormats = (items: ClipboardDataItem[]): string[] => {
    return [...new Set<string>(items.flatMap(item => item.types).map((type: string) => {
        const match = /^electron application\/osclipboard;format="((?:\\.|[^"\\])*)"$/.exec(type);
        return match ? match[1].replace(/\\(.)/g, "$1") : type;
    }))];
};

const parseClipboardFilePaths = (text: string): string[] => text.split(/\r?\n/).flatMap((line: string) => {
    const uri = line.trim();
    if (!uri || uri.startsWith("#")) {
        return [];
    }
    try {
        return [fileURLToPath(uri)];
    } catch {
        return [];
    }
});

// 不同平台复制的行尾不一致，比较剪贴板快照前先统一。
const normalizeClipboardText = (text: string): string => text.replace(/\r\n?/g, "\n");

export {
    rawFormatType, readClipboardBuffer, readClipboardText, getClipboardFormats, parseClipboardFilePaths,
    normalizeClipboardText,
};
