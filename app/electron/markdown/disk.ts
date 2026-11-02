import * as fs from "node:fs/promises";
import {constants} from "node:fs";
import * as path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {MarkdownTargetRegistry} from "./registry";
import {decodeMarkdown, encodeMarkdown} from "./codec";
import {replaceFile, preserveOwnership, syncDirectory} from "./replaceFile";
import type {BigIntStats} from "node:fs";
import type {MarkdownEntry, MarkdownFileDescriptor, MarkdownSnapshot} from "./registry";
import type {MarkdownIOError} from "./types";
import type {MarkdownBlocked, MarkdownErrorCode, MarkdownFailure, MarkdownFormat, MarkdownReadRequest,
    MarkdownReadResult, MarkdownTarget, MarkdownWriteRequest, MarkdownWriteResult} from "../../src/markdown/contracts";

type Occupied = {kind: "occupied"; sessionId: string};
export type MarkdownOpenAuthorization = {kind: "opened"; target: MarkdownTarget; content: string} | Occupied | MarkdownBlocked;
export type MarkdownSaveAsAuthorization = {kind: "reserved"; target: MarkdownTarget; content: string; reservationId: string} |
    Occupied | MarkdownBlocked;

const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const identity = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;
const maximumBytes = 8 * 1024 * 1024;
// macOS 也可能使用区分大小写的卷；保守合并这些路径只会拒绝重复打开，不会允许覆盖。
const pathKey = (value: string): string => "path:" + (["win32", "darwin"].includes(process.platform) ? value.toLowerCase() : value);
const sameStat = (left: BigIntStats, right: BigIntStats): boolean => identity(left) === identity(right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const diskError = (code: MarkdownErrorCode, message: string): MarkdownIOError => Object.assign(new Error(message), {markdownCode: code});
const failure = <Kind extends "blocked" | "indeterminate">(kind: Kind, cause: unknown): {kind: Kind; error: MarkdownFailure} => {
    const error = cause as MarkdownIOError;
    const code = error.markdownCode || ({ENOENT: "deleted", EACCES: "permission", EPERM: "permission", EROFS: "readonly",
        ENOSPC: "space", EDQUOT: "space", EIO: "io", ENETDOWN: "offline", ENETUNREACH: "offline"} as Record<string, MarkdownErrorCode>)[error.code ?? ""] ||
        (error instanceof TypeError ? "encoding" : "io");
    return {kind, error: {code, recoverable: !["encoding", "size", "protocol"].includes(code)}};
};

const readBounded = async (file: fs.FileHandle): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - size));
        const {bytesRead} = await file.read(chunk, 0, chunk.length, null);
        if (!bytesRead) return Buffer.concat(chunks, size);
        size += bytesRead;
        if (size > maximumBytes) throw diskError("size", "Markdown file is too large");
        chunks.push(chunk.subarray(0, bytesRead));
    }
};

class MarkdownDiskService {
    readonly fs: typeof fs;
    readonly replace: typeof replaceFile;
    readonly registry: MarkdownTargetRegistry;
    readonly synchronizeDirectory: (directory: string) => Promise<void>;
    readonly queues: Map<string, Promise<MarkdownWriteResult>>;
    constructor({fileSystem = fs, registry = new MarkdownTargetRegistry(), replace = replaceFile,
        synchronizeDirectory = directory => syncDirectory(directory, {fileSystem})}: {
            fileSystem?: typeof fs; registry?: MarkdownTargetRegistry; replace?: typeof replaceFile;
            synchronizeDirectory?: (directory: string) => Promise<void>;
        } = {}) {
        this.fs = fileSystem;
        this.replace = replace;
        this.registry = registry;
        this.synchronizeDirectory = synchronizeDirectory;
        this.queues = new Map();
    }

    createSession(sessionId?: string): string {
        return this.registry.createSession(sessionId);
    }

    // 仅限原生对话框、系统 open-file 和经过宿主确认的拖放入口调用。
    async describe(filePath: string, allowMissing = false): Promise<MarkdownFileDescriptor> {
        if (typeof filePath !== "string" || !path.isAbsolute(filePath) || !/\.(md|markdown)$/i.test(filePath)) {
            throw diskError("protocol", "Invalid Markdown file selection");
        }
        let realPath;
        try {
            realPath = await this.fs.realpath(filePath);
        } catch (caught) {
            const error = caught as MarkdownIOError;

            if (!allowMissing || error.code !== "ENOENT") throw error;
            // 不允许把失效符号链接当成新文件；只允许最后一级文件不存在。
            try {
                await this.fs.lstat(filePath);
                throw new Error("Markdown target is a broken link", {cause: caught});
            } catch (caught) {
                const linkError = caught as MarkdownIOError;

                if (linkError.code !== "ENOENT") throw linkError;
            }
            realPath = path.join(await this.fs.realpath(path.dirname(filePath)), path.basename(filePath));
            return {path: realPath, selection: filePath, keys: [pathKey(realPath)], baseline: "missing",
                identity: "missing", mode: 0o600, writable: true};
        }
        const stat = await this.fs.stat(realPath, {bigint: true});
        if (!stat.isFile()) throw new Error("Markdown target is not a regular file");
        let writable = (Number(stat.mode) & 0o222) !== 0;
        if (writable) {
            try {
                await this.fs.access(realPath, constants.W_OK);
            } catch (caught) {
                const error = caught as MarkdownIOError;

                if (!["EACCES", "EPERM", "EROFS"].includes(error.code ?? "")) throw error;
                writable = false;
            }
        }
        return {path: realPath, selection: filePath, keys: [pathKey(realPath), "file:" + identity(stat)],
            identity: identity(stat), mode: Number(stat.mode) & 0o777, uid: Number(stat.uid), gid: Number(stat.gid), writable};
    }

    async snapshot(descriptor: MarkdownFileDescriptor, allowMissing = false): Promise<MarkdownSnapshot> {
        const current = await this.describe(descriptor.selection, allowMissing);
        if (current.path !== descriptor.path) throw diskError("identity-changed", "Markdown target path changed");
        if (current.identity === "missing") return current as MarkdownSnapshot;
        const file = await this.fs.open(current.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            const before = await file.stat({bigint: true});
            if (!before.isFile() || identity(before) !== current.identity) throw new Error("Markdown target changed while opening");
            if (before.size > BigInt(maximumBytes)) throw diskError("size", "Markdown file is too large");
            const bytes = await readBounded(file);
            if (bytes.length > maximumBytes) throw diskError("size", "Markdown file is too large");
            const after = await file.stat({bigint: true});
            const resolved = await this.describe(descriptor.selection);
            if (!sameStat(before, after) || resolved.path !== current.path || resolved.identity !== current.identity) {
                throw new Error("Markdown target changed while reading");
            }
            return {...current, bytes, baseline: hash(`${current.identity}:${hash(bytes)}`)};
        } finally {
            await file.close();
        }
    }

    target(entry: MarkdownEntry): MarkdownTarget {
        return {handle: entry.handle, identity: entry.targetIdentity,
            displayName: path.basename(entry.descriptor.selection), baseline: entry.descriptor.baseline!,
            writable: entry.descriptor.writable, format: {...entry.format!}, capabilities: {persistentPermission: false,
                conditionalWrite: false, atomicReplace: true, coordinatedAccess: false}};
    }

    grant(sessionId: string, filePath: string, reserved: false, format?: MarkdownFormat): Promise<MarkdownOpenAuthorization>;
    grant(sessionId: string, filePath: string, reserved: true, format?: MarkdownFormat): Promise<MarkdownSaveAsAuthorization>;
    async grant(sessionId: string, filePath: string, reserved: boolean, format?: MarkdownFormat):
        Promise<MarkdownOpenAuthorization | MarkdownSaveAsAuthorization> {
        format = format && {...format};
        let entry: MarkdownEntry | undefined;
        let held = false;
        try {
            this.registry.assertSession(sessionId);
            const descriptor = await this.describe(filePath, reserved);
            const claimed = this.registry.claim(sessionId, descriptor, reserved);
            if (claimed.kind === "occupied") return claimed;
            entry = claimed.entry;
            // 占用登记在首次读取之前完成，读文件期间其他会话也不能抢占该目标。
            entry.pending++;
            held = true;
            const snapshot = await this.snapshot(descriptor, reserved);
            const decoded = snapshot.bytes ? decodeMarkdown(snapshot.bytes) : {content: "", format: {bom: false, newline: "\n" as const}};
            this.registry.update(entry, snapshot);
            entry.format = format || decoded.format;
            encodeMarkdown("", entry.format);
            return reserved ? {kind: "reserved", target: this.target(entry), content: decoded.content, reservationId: entry.reservationId!} :
                {kind: "opened", target: this.target(entry), content: decoded.content};
        } catch (error) {
            if (held) {
                entry!.pending--;
                held = false;
                this.registry.release(entry!);
            }
            return failure("blocked", error);
        } finally {
            if (held) entry!.pending--;
        }
    }

    authorizeOpen(sessionId: string, filePath: string) {
        return this.grant(sessionId, filePath, false);
    }

    authorizeSaveAs(sessionId: string, filePath: string, format?: MarkdownFormat) {
        return this.grant(sessionId, filePath, true, format);
    }

    async read({sessionId, target}: MarkdownReadRequest): Promise<MarkdownReadResult> {
        let entry: MarkdownEntry | undefined;
        let reading = false;
        try {
            entry = this.registry.get(sessionId, target.handle);
            if (entry.state === "indeterminate") throw new Error("Markdown write outcome is unresolved");
            entry.pending++;
            reading = true;
            const snapshot = await this.snapshot(entry.descriptor);
            if (snapshot.identity !== entry.descriptor.identity) {
                throw diskError("identity-changed", "Markdown target was replaced outside this session");
            }
            const decoded = decodeMarkdown(snapshot.bytes!);
            // 读取结果是否成为新基线由会话版本校验决定，此处不推进宿主保存基线。
            return {kind: "read", content: decoded.content,
                target: {...this.target(entry), baseline: snapshot.baseline, format: decoded.format}};
        } catch (error) {
            return failure("blocked", error);
        } finally {
            if (reading) entry!.pending--;
        }
    }

    write(request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        let entry: MarkdownEntry;
        try {
            entry = this.registry.get(request.sessionId, request.target.handle);
            if (entry.state === "indeterminate" || (entry.state === "reserved" && entry.reservationId !== request.reservationId)) {
                throw new Error("Markdown write is not authorized");
            }
        } catch (error) {
            return Promise.resolve(failure("blocked", error));
        }
        entry.pending++;
        // 复制内容和格式；异步队列不得读取调用方随后改变的对象。
        const task = {...request, target: {...request.target, format: {...request.target.format}}};
        const previous = this.queues.get(entry.handle) || Promise.resolve();
        const pending = previous.then(() => this.writeSnapshot(entry, task)).finally(() => {
            entry.pending--;
            if (this.queues.get(entry.handle) === pending) this.queues.delete(entry.handle);
        });
        this.queues.set(entry.handle, pending);
        return pending;
    }

    async writeSnapshot(entry: MarkdownEntry, request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        let temporaryPath: string | undefined;
        let backupPath: string | undefined;
        let attempted = false;
        let original: MarkdownSnapshot | undefined;
        try {
            if (entry.state === "indeterminate") throw new Error("Markdown write outcome is unresolved");
            const bytes = encodeMarkdown(request.content, request.target.format);
            if (bytes.length > maximumBytes) throw diskError("size", "Markdown file is too large");
            original = await this.snapshot(entry.descriptor, entry.state === "reserved");
            if (original.identity !== entry.descriptor.identity) {
                throw diskError("identity-changed", "Markdown target was replaced outside this session");
            }
            if (!original.writable) throw diskError("readonly", "Markdown target is read-only");
            if (original.baseline !== request.expectedBaseline) return {kind: "conflict", baseline: original.baseline};
            temporaryPath = path.join(path.dirname(entry.descriptor.path), ".siyuan-markdown-" + randomUUID() + ".tmp");
            const file = await this.fs.open(temporaryPath, "wx", original.mode);
            try {
                await file.writeFile(bytes);
                await preserveOwnership(file, original);
                await file.sync();
            } finally {
                await file.close();
            }
            const current = await this.snapshot(entry.descriptor, entry.state === "reserved");
            if (current.identity !== original.identity) {
                throw diskError("identity-changed", "Markdown target was replaced before saving");
            }
            if (!current.writable) throw diskError("readonly", "Markdown target became read-only");
            if (process.platform !== "win32" && original.identity !== "missing" &&
                (current.mode !== original.mode || current.uid !== original.uid || current.gid !== original.gid)) {
                throw diskError("permission", "Markdown target permissions changed before saving");
            }
            if (current.baseline !== original.baseline) return {kind: "conflict", baseline: current.baseline};
            attempted = true;
            if (original.identity === "missing") {
                // link 对已存在目标返回 EEXIST，消除新文件检查与创建之间的覆盖窗口。
                await this.fs.link(temporaryPath, entry.descriptor.path);
            } else {
                // 不使用 unlink 后 rename 的降级方案；不支持原子替换的提供者应返回失败。
                if (process.platform === "win32") backupPath = temporaryPath + ".backup";
                await this.replace(temporaryPath, entry.descriptor.path, backupPath, {fileSystem: this.fs});
                temporaryPath = undefined;
            }
            const saved = await this.snapshot(entry.descriptor);
            if (!saved.bytes || hash(saved.bytes) !== hash(bytes)) throw new Error("Markdown replacement could not be verified");
            await this.synchronizeDirectory(path.dirname(entry.descriptor.path));
            this.registry.update(entry, saved);
            entry.format = {...request.target.format};
            entry.written = true;
            return {kind: "committed", baseline: saved.baseline, durability: "local"};
        } catch (caught) {
            const error = caught as MarkdownIOError;

            if (attempted && original!.identity === "missing" && error.code === "EEXIST") {
                return {kind: "conflict"};
            }
            if (attempted) {
                try {
                    const current = await this.snapshot(entry.descriptor, true);
                    if (current.baseline === original!.baseline) return failure("blocked", error);
                } catch { /* 无法证实原文件未变更时必须保留占用。 */ }
                entry.uncertain = {operationId: request.operationId, expectedBaseline: request.expectedBaseline,
                    hash: hash(encodeMarkdown(request.content, request.target.format)),
                    format: {...request.target.format}, previousState: entry.state};
                entry.state = "indeterminate";
                entry.recoveryTemporaryPath = temporaryPath;
                entry.recoveryBackupPath = backupPath;
                temporaryPath = undefined;
                backupPath = undefined;
                return failure("indeterminate", error);
            }
            return failure("blocked", error);
        } finally {
            if (temporaryPath) await this.fs.unlink(temporaryPath).catch(() => {});
            if (backupPath) await this.fs.unlink(backupPath).catch(() => {});
        }
    }

    async reconcileWrite(request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        let entry: MarkdownEntry | undefined;
        let checking = false;
        try {
            entry = this.registry.get(request.sessionId, request.target.handle);
            const uncertain = entry.uncertain;
            if (!uncertain || entry.pending || uncertain.operationId !== request.operationId ||
                uncertain.expectedBaseline !== request.expectedBaseline ||
                uncertain.hash !== hash(encodeMarkdown(request.content, request.target.format))) {
                throw diskError("protocol", "Markdown write reconciliation does not match");
            }
            entry.pending++;
            checking = true;
            const current = await this.snapshot(entry.descriptor, true);
            let result: MarkdownWriteResult;
            if (current.bytes && hash(current.bytes) === uncertain.hash) {
                await this.synchronizeDirectory(path.dirname(entry.descriptor.path));
                this.registry.update(entry, current);
                entry.format = uncertain.format;
                entry.written = true;
                result = {kind: "committed", baseline: current.baseline, durability: "local"};
            } else if (current.baseline === uncertain.expectedBaseline) {
                result = failure("blocked", diskError("io", "Markdown replacement was not committed"));
            } else {
                return failure("indeterminate", diskError("io", "Markdown replacement remains unresolved"));
            }
            entry.state = uncertain.previousState;
            entry.uncertain = undefined;
            if (entry.recoveryTemporaryPath) {
                await this.fs.unlink(entry.recoveryTemporaryPath).catch(() => {});
                entry.recoveryTemporaryPath = undefined;
            }
            if (entry.recoveryBackupPath) {
                await this.fs.unlink(entry.recoveryBackupPath).catch(() => {});
                entry.recoveryBackupPath = undefined;
            }
            return result;
        } catch (error) {
            return failure(entry?.state === "indeterminate" ? "indeterminate" : "blocked", error);
        } finally {
            if (checking) entry!.pending--;
        }
    }

    commitSaveAs({sessionId, target, reservationId, previousTarget}: {
        sessionId: string; target: MarkdownTarget; reservationId: string; previousTarget?: MarkdownTarget;
    }): MarkdownTarget {
        return this.target(this.registry.commitSaveAs(sessionId, target.handle, reservationId, previousTarget?.handle));
    }

    releaseSaveAs({sessionId, target, reservationId}: {sessionId: string; target: MarkdownTarget; reservationId: string}): boolean {
        return this.registry.releaseSaveAs(sessionId, target.handle, reservationId);
    }

    closeSession(sessionId: string): boolean {
        return this.registry.closeSession(sessionId);
    }
}

export {MarkdownDiskService};
