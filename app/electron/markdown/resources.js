const fs = require("node:fs/promises");
const {constants} = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

const imageTypes = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon"};
const inside = (directory, candidate) => {
    const relative = path.relative(directory, candidate);
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
const identity = stat => `${stat.dev}:${stat.ino}`;

class MarkdownResources {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.directories = new Set();
        this.files = new Map();
        this.entries = new Map();
    }

    async authorizeDirectory(directory) {
        const canonical = await fs.realpath(directory);
        if (!(await fs.stat(canonical)).isDirectory()) throw new Error("Invalid Markdown resource directory");
        this.directories.add(canonical);
    }

    async authorizeFile(file) {
        const canonical = await fs.realpath(file);
        const stat = await fs.stat(canonical, {bigint: true});
        if (!stat.isFile() || !imageTypes[path.extname(canonical).toLowerCase()]) throw new Error("Invalid Markdown resource file");
        this.files.set(canonical, identity(stat));
    }

    authorized(canonical, fileIdentity) {
        return [...this.directories].some(directory => inside(directory, canonical)) || this.files.get(canonical) === fileIdentity;
    }

    async resolve(reference, targetPath) {
        if (typeof reference !== "string" || reference.length > 8192 || !targetPath ||
            /^[a-z][\w+.-]*:/i.test(reference) || reference.startsWith("/") || reference.startsWith("\\") || reference.includes("\0")) return undefined;
        try {
            const withoutFragment = reference.split("#", 1)[0].split("?", 1)[0];
            const relative = decodeURIComponent(withoutFragment);
            if (path.isAbsolute(relative) || /^[a-z][\w+.-]*:/i.test(relative) || relative.includes("\0")) return undefined;
            const selection = path.resolve(path.dirname(targetPath), relative);
            const canonical = await fs.realpath(selection);
            const type = imageTypes[path.extname(canonical).toLowerCase()];
            const stat = await fs.stat(canonical, {bigint: true});
            if (!type || !stat.isFile() || stat.size > 32n * 1024n * 1024n || !this.authorized(canonical, identity(stat))) return undefined;
            for (const [token, entry] of this.entries) {
                if (entry.selection === selection && entry.canonical === canonical && entry.identity === identity(stat) && entry.modified === stat.mtimeNs) {
                    return `siyuan-markdown://${this.sessionId}/resource/${token}`;
                }
            }
            if (this.entries.size >= 1024) return undefined;
            const token = randomUUID();
            this.entries.set(token, {selection, canonical, type, identity: identity(stat), modified: stat.mtimeNs});
            return `siyuan-markdown://${this.sessionId}/resource/${token}`;
        } catch {
            return undefined;
        }
    }

    async read(token) {
        const entry = this.entries.get(token);
        if (!entry || await fs.realpath(entry.selection) !== entry.canonical || !this.authorized(entry.canonical, entry.identity)) return undefined;
        const file = await fs.open(entry.canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            const stat = await file.stat({bigint: true});
            if (!stat.isFile() || identity(stat) !== entry.identity || stat.size > 32n * 1024n * 1024n) return undefined;
            const bytes = Buffer.alloc(Number(stat.size));
            let offset = 0;
            while (offset < bytes.length) {
                const read = await file.read(bytes, offset, bytes.length - offset, offset);
                if (!read.bytesRead) break;
                offset += read.bytesRead;
            }
            const after = await file.stat({bigint: true});
            if (offset !== bytes.length || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) return undefined;
            return {bytes, type: entry.type};
        } finally {
            await file.close();
        }
    }

    clear() {
        this.entries.clear();
    }
}

module.exports = {MarkdownResources, inside};
