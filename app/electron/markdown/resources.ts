import * as fs from "node:fs/promises";
import {constants} from "node:fs";
import * as path from "node:path";
import {randomUUID} from "node:crypto";
import type {BigIntStats} from "node:fs";

const imageTypes: Record<string, string> = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon"};
const inside = (directory: string, candidate: string): boolean => {
    const relative = path.relative(directory, candidate);
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
const identity = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;

class MarkdownResources {
    readonly sessionId: string;
    readonly directories: Map<string, {canonical: string; identity: string}>;
    readonly files: Map<string, string>;
    readonly entries: Map<string, {selection: string; canonical: string; type: string; identity: string; modified: bigint}>;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.directories = new Map();
        this.files = new Map();
        this.entries = new Map();
    }

    async authorizeDirectory(directory: string): Promise<void> {
        const canonical = await fs.realpath(directory);
        const stat = await fs.stat(canonical, {bigint: true});
        if (!stat.isDirectory()) throw new Error("Invalid Markdown resource directory");
        this.directories.set(path.resolve(directory), {canonical, identity: identity(stat)});
    }

    async authorizeFile(file: string): Promise<void> {
        const canonical = await fs.realpath(file);
        const stat = await fs.stat(canonical, {bigint: true});
        if (!stat.isFile() || !imageTypes[path.extname(canonical).toLowerCase()]) throw new Error("Invalid Markdown resource file");
        this.files.set(canonical, identity(stat));
    }

    async authorized(canonical: string, fileIdentity: string): Promise<boolean> {
        if (this.files.get(canonical) === fileIdentity) return true;
        for (const [selection, grant] of this.directories) {
            if (!inside(grant.canonical, canonical)) continue;
            try {
                if (await fs.realpath(selection) === grant.canonical &&
                    identity(await fs.stat(grant.canonical, {bigint: true})) === grant.identity) return true;
            } catch { /* 失效目录需要用户重新授权。 */ }
        }
        return false;
    }

    async resolve(reference: unknown, targetPath?: string): Promise<string | undefined> {
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
            if (!type || !stat.isFile() || stat.size > 32n * 1024n * 1024n || !await this.authorized(canonical, identity(stat))) return undefined;
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

    async read(token: string): Promise<{bytes: Buffer<ArrayBuffer>; type: string} | undefined> {
        const entry = this.entries.get(token);
        if (!entry || await fs.realpath(entry.selection) !== entry.canonical || !await this.authorized(entry.canonical, entry.identity)) return undefined;
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
            if (!await this.authorized(entry.canonical, entry.identity)) return undefined;
            return {bytes, type: entry.type};
        } finally {
            await file.close();
        }
    }

    clear(): void {
        this.entries.clear();
    }
}

export {MarkdownResources, inside};
