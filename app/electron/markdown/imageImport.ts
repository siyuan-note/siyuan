import type {MarkdownIOError} from "./types";
import * as fs from "node:fs/promises";
import {constants} from "node:fs";
import * as path from "node:path";
import {randomUUID, createHash} from "node:crypto";
import type {BigIntStats} from "node:fs";
import type {MarkdownErrorCode} from "../../src/markdown/contracts";

type ImageErrorCode = MarkdownErrorCode | "occupied" | "cross-volume";
type ImageImportResult = {kind: "imported"; reference: string} |
    {kind: "blocked" | "indeterminate"; error: {code: ImageErrorCode; recoverable: boolean}};

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"]);
const identity = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;
const stable = (before: BigIntStats, after: BigIntStats): boolean => identity(before) === identity(after) && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const error = (code: ImageErrorCode) => Object.assign(new Error("Markdown image import failed"), {markdownCode: code});
const failure = (kind: "blocked" | "indeterminate", caught: unknown): Exclude<ImageImportResult, {kind: "imported"}> => {
    const cause = caught as MarkdownIOError<ImageErrorCode>;
    return {kind, error: {code: cause.markdownCode ||
        ({EEXIST: "occupied", ENOENT: "deleted", EACCES: "permission", EPERM: "permission", ENOSPC: "space"} as
            Record<string, ImageErrorCode>)[cause.code ?? ""] || "io", recoverable: true}};
};

const readImage = async (io: typeof fs, canonical: string, maximumBytes: number): Promise<{bytes: Buffer; stat: BigIntStats}> => {
    const selected = await io.stat(canonical, {bigint: true});
    const file = await io.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const before = await file.stat({bigint: true});
        if (!before.isFile()) throw error("protocol");
        if (!stable(selected, before)) throw error("identity-changed");
        if (before.size > BigInt(maximumBytes)) throw error("size");
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
            const bytes = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - total));
            const {bytesRead} = await file.read(bytes, 0, bytes.length, null);
            if (!bytesRead) break;
            total += bytesRead;
            if (total > maximumBytes) throw error("size");
            chunks.push(bytes.subarray(0, bytesRead));
        }
        if (!stable(before, await file.stat({bigint: true}))) throw error("identity-changed");
        return {bytes: Buffer.concat(chunks, total), stat: before};
    } finally {
        await file.close();
    }
};

// 路径只能来自宿主原生选择器和当前授权文档，不接受渲染层自行提供的路径。
const importMarkdownImage = async ({source, destination, targetPath}: {source: string; destination: string; targetPath: string},
    {fileSystem: io = fs, maximumBytes = 32 * 1024 * 1024}: {fileSystem?: typeof fs; maximumBytes?: number} = {}): Promise<ImageImportResult> => {
    let temporary: string | undefined;
    let attempted = false;
    let canonicalDestination: string | undefined;
    try {
        if (![source, destination, targetPath].every(value => typeof value === "string" && path.isAbsolute(value)) ||
            !imageExtensions.has(path.extname(source).toLowerCase()) || !imageExtensions.has(path.extname(destination).toLowerCase()) ||
            !/\.(?:md|markdown)$/i.test(targetPath)) throw error("protocol");
        const document = await io.realpath(targetPath);
        if (!(await io.stat(document)).isFile()) throw error("protocol");
        const parent = await io.realpath(path.dirname(destination));
        canonicalDestination = path.join(parent, path.basename(destination));
        const relative = path.relative(path.dirname(document), canonicalDestination);
        if (!relative || path.isAbsolute(relative)) throw error("cross-volume");
        const parentStat = await io.stat(parent, {bigint: true});
        try {
            await io.lstat(canonicalDestination);
            throw error("occupied");
        } catch (caught) {
            const cause = caught as MarkdownIOError;

            if (cause.code !== "ENOENT") throw cause;
        }
        const canonicalSource = await io.realpath(source);
        const original = await readImage(io, canonicalSource, maximumBytes);
        if (await io.realpath(source) !== canonicalSource || !stable(await io.stat(canonicalSource, {bigint: true}), original.stat)) {
            throw error("identity-changed");
        }
        temporary = path.join(parent, ".siyuan-image-" + randomUUID() + ".tmp");
        const file = await io.open(temporary, "wx", 0o600);
        try {
            await file.writeFile(original.bytes);
            await file.sync();
        } finally {
            await file.close();
        }
        if (await io.realpath(path.dirname(destination)) !== parent || await io.realpath(source) !== canonicalSource ||
            identity(await io.stat(parent, {bigint: true})) !== identity(parentStat) ||
            !stable(await io.stat(canonicalSource, {bigint: true}), original.stat)) throw error("identity-changed");
        attempted = true;
        // 只创建新目标；检查后出现同名文件时 link 会失败，不得退回覆盖写入。
        await io.link(temporary, canonicalDestination);
        const saved = await readImage(io, canonicalDestination, maximumBytes);
        if (hash(saved.bytes) !== hash(original.bytes)) throw error("io");
        if (process.platform !== "win32") {
            const directory = await io.open(parent, "r");
            try { await directory.sync(); } finally { await directory.close(); }
        }
        return {kind: "imported", reference: relative.split(path.sep).map(encodeURIComponent).join("/")};
    } catch (caught) {
        const cause = caught as MarkdownIOError;

        if (attempted && cause.code !== "EEXIST") {
            try {
                await io.lstat(canonicalDestination!);
                return failure("indeterminate", cause);
            } catch (caught) {
                const check = caught as MarkdownIOError;

                if (check.code !== "ENOENT") return failure("indeterminate", cause);
            }
        }
        return failure("blocked", cause);
    } finally {
        if (temporary) await io.unlink(temporary).catch(() => {});
    }
};

export {importMarkdownImage, imageExtensions};
