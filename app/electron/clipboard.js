const rawFormatType = (format) => `electron application/osclipboard;format="${format.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const {fileURLToPath} = require("url");

const readClipboardBuffer = async (items, type) => {
    for (const item of items) {
        if (item.types.includes(type)) {
            const blob = await item.getType(type);
            return Buffer.from(await blob.arrayBuffer());
        }
    }
    return Buffer.alloc(0);
};

const readClipboardText = async (items, type) => {
    return (await readClipboardBuffer(items, type)).toString("utf8");
};

const getClipboardFormats = (items) => {
    return [...new Set(items.flatMap(item => item.types).map(type => {
        const match = /^electron application\/osclipboard;format="((?:\\.|[^"\\])*)"$/.exec(type);
        return match ? match[1].replace(/\\(.)/g, "$1") : type;
    }))];
};

const parseClipboardFilePaths = (text) => text.split(/\r?\n/).flatMap(line => {
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

module.exports = {rawFormatType, readClipboardBuffer, readClipboardText, getClipboardFormats, parseClipboardFilePaths};
