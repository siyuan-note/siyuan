import type {MarkdownIOError} from "./types";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {MarkdownDraft, MarkdownDraftWatermark, MarkdownSaveAsCommit, MarkdownTarget} from "../../src/markdown/contracts";
import type {MarkdownHostData, MarkdownSaveAsPreparation} from "./types";

type RecoveryLimits = {documentBytes: number; totalBytes: number; records: number};
export type MarkdownRecoveryRecord = {
    watermark: MarkdownDraftWatermark; cleared: boolean; updatedAt: number; draft?: MarkdownDraft;
    intent?: MarkdownSaveAsPreparation & {hostData?: MarkdownHostData}; hostData?: MarkdownHostData;
    binding?: MarkdownTarget; committedOperationId?: string;
};

// 草稿不自动过期或淘汰，达到容量上限时明确报错，由用户处理恢复记录。
const RECOVERY_LIMITS = Object.freeze({documentBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, records: 1024});
const hash = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const storeError = (code: string, message: string) => Object.assign(new Error(message), {code});
const validId = (value: unknown): value is string => typeof value === "string" && /^[\w:-]{1,256}$/.test(value);
const validCounter = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validateStamp = (value: MarkdownDraftWatermark): void => {
    if (!value || !validId(value.sessionId) || !validCounter(value.targetGeneration) || !validCounter(value.revision)) {
        throw storeError("EINVAL", "Invalid Markdown recovery version");
    }
};
const compare = (a: MarkdownDraftWatermark, b: MarkdownDraftWatermark): number => a.targetGeneration - b.targetGeneration || a.revision - b.revision;
const stamp = (value: MarkdownDraftWatermark): MarkdownDraftWatermark =>
    ({sessionId: value.sessionId, targetGeneration: value.targetGeneration, revision: value.revision});
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const validateDraft = (value: MarkdownDraft, limits: RecoveryLimits): void => {
    validateStamp(value);
    if (!validId(value.operationId) || typeof value.content !== "string" || !value.format ||
        typeof value.format.bom !== "boolean" || !["\n", "\r\n", "\r"].includes(value.format.newline)) {
        throw storeError("EINVAL", "Invalid Markdown recovery draft");
    }
    if (Buffer.byteLength(value.content, "utf8") > limits.documentBytes) {
        throw storeError("EFBIG", "Markdown recovery document limit exceeded");
    }
};

// 每个进程仅创建一个宿主存储实例；单实例锁负责防止多个进程同时拥有此目录。
const createMarkdownRecoveryStore = (directory: string, options: {fs?: typeof fs; limits?: Partial<RecoveryLimits>} = {}) => {
    if (!path.isAbsolute(directory)) {
        throw storeError("EINVAL", "Markdown recovery directory must be absolute");
    }
    const io = options.fs || fs;
    const limits = {...RECOVERY_LIMITS, ...options.limits};
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <Result>(operation: () => Result | Promise<Result>): Promise<Result> => {
        const result = queue.then(operation);
        queue = result.catch(() => undefined);
        return result;
    };
    const fileFor = (sessionId: string): string => path.join(directory, hash(sessionId) + ".json");
    const readFile = async (file: string): Promise<MarkdownRecoveryRecord | undefined> => {
        let bytes: Buffer;
        try {
            const stat = await io.stat(file);
            if (stat.size > limits.totalBytes) {
                throw storeError("EFBIG", "Markdown recovery record limit exceeded");
            }
            bytes = await io.readFile(file);
        } catch (caught) {
            const error = caught as MarkdownIOError;

            if (error.code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
        try {
            const envelope = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
            if (envelope.version !== 1 || typeof envelope.payload !== "string" || hash(envelope.payload) !== envelope.checksum) {
                throw new Error("checksum");
            }
            const record: MarkdownRecoveryRecord = JSON.parse(envelope.payload);
            validateStamp(record.watermark);
            if (path.basename(file) !== path.basename(fileFor(record.watermark.sessionId)) ||
                typeof record.cleared !== "boolean" || !Number.isSafeInteger(record.updatedAt)) {
                throw new Error("identity");
            }
            if (record.draft) {
                validateDraft(record.draft, limits);
                if (record.draft.sessionId !== record.watermark.sessionId || compare(record.draft, record.watermark) !== 0 || record.cleared) {
                    throw new Error("draft version");
                }
            }
            if (record.intent) {
                validateDraft({...record.intent.operation, format: record.intent.operation.target?.format}, limits);
                if (record.intent.operation.sessionId !== record.watermark.sessionId ||
                    !validId(record.intent.operation.reservationId)) {
                    throw new Error("transaction");
                }
            }
            return record;
        } catch (error) {
            throw storeError("ECORRUPT", "Invalid Markdown recovery record: " + path.basename(file));
        }
    };
    const entries = async (): Promise<string[]> => {
        try {
            return (await io.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        } catch (caught) {
            const error = caught as MarkdownIOError;

            if (error.code === "ENOENT") {
                return [];
            }
            throw error;
        }
    };
    const write = async (record: MarkdownRecoveryRecord): Promise<void> => {
        const file = fileFor(record.watermark.sessionId);
        const payload = JSON.stringify(record);
        const data = JSON.stringify({version: 1, checksum: hash(payload), payload});
        const files = await entries();
        if (!files.includes(path.basename(file)) && files.length >= limits.records) {
            throw storeError("ENOSPC", "Markdown recovery record count exceeded");
        }
        let totalBytes = Buffer.byteLength(data);
        for (const name of files) {
            if (name !== path.basename(file)) {
                totalBytes += (await io.stat(path.join(directory, name))).size;
            }
        }
        if (totalBytes > limits.totalBytes) {
            throw storeError("ENOSPC", "Markdown recovery capacity exceeded");
        }
        await io.mkdir(directory, {recursive: true, mode: 0o700});
        const temporary = file + "." + crypto.randomBytes(16).toString("hex") + ".tmp";
        let handle: fs.FileHandle | undefined;
        try {
            handle = await io.open(temporary, "wx", 0o600);
            await handle.writeFile(data, "utf8");
            await handle.sync();
            await handle.close();
            handle = undefined;
            await io.rename(temporary, file);
            // Windows 不支持目录 fsync；其他平台同步目录项以持久化替换结果。
            if (process.platform !== "win32") {
                const parent = await io.open(directory, "r");
                try {
                    await parent.sync();
                } finally {
                    await parent.close();
                }
            }
        } finally {
            if (handle) {
                await handle.close().catch(() => undefined);
            }
            await io.unlink(temporary).catch((error: MarkdownIOError) => {
                if (error.code !== "ENOENT") {
                    throw error;
                }
            });
        }
    };
    const fresh = (value: MarkdownDraftWatermark): MarkdownRecoveryRecord => ({watermark: stamp(value), cleared: false, updatedAt: Date.now()});

    return {
        putDraft(draft: MarkdownDraft, hostData?: MarkdownHostData) {
            validateDraft(draft, limits);
            const snapshot = clone(draft);
            const metadata = hostData === undefined ? undefined : clone(hostData);
            return enqueue(async () => {
                const current = await readFile(fileFor(snapshot.sessionId));
                if (current && (compare(snapshot, current.watermark) < 0 ||
                    (compare(snapshot, current.watermark) === 0 && current.cleared))) {
                    return;
                }
                await write({...current, ...fresh(snapshot), draft: snapshot, hostData: metadata ?? current?.hostData});
            });
        },
        clearDraft(watermark: MarkdownDraftWatermark) {
            validateStamp(watermark);
            const snapshot = stamp(watermark);
            return enqueue(async () => {
                const current = await readFile(fileFor(snapshot.sessionId));
                if (current && compare(snapshot, current.watermark) < 0) {
                    return;
                }
                // 未结束的另存为意图独立保留，清理草稿不能抹去待核验的目标写入。
                await write({...current, ...fresh(snapshot), cleared: true, draft: undefined});
            });
        },
        prepareSaveAs(request: MarkdownSaveAsPreparation, hostData?: MarkdownHostData) {
            const intent = clone({...request, hostData});
            const {operation} = intent;
            validateDraft({...operation, format: operation.target?.format}, limits);
            if (!validId(operation.reservationId) || operation.targetGeneration < 1) {
                throw storeError("EINVAL", "Missing Markdown target reservation");
            }
            return enqueue(async () => {
                const current = await readFile(fileFor(operation.sessionId));
                if (current?.intent) {
                    if (JSON.stringify(current.intent) === JSON.stringify(intent)) {
                        return;
                    }
                    throw storeError("EBUSY", "Markdown target transaction is unsettled");
                }
                if (current && current.watermark.targetGeneration !== operation.targetGeneration - 1) {
                    throw storeError("ESTALE", "Stale Markdown target transaction");
                }
                const sourceDraft = {...operation, target: intent.previousTarget, targetGeneration: operation.targetGeneration - 1,
                    format: intent.previousTarget?.format ?? operation.target.format};
                const record = current || {...fresh(sourceDraft), draft: sourceDraft};
                await write({...record, intent, updatedAt: Date.now()});
            });
        },
        commitSaveAs(request: MarkdownSaveAsCommit & {receipt: MarkdownSaveAsCommit["receipt"] & {identity?: string}}, hostData?: MarkdownHostData) {
            const snapshot = clone(request);
            const metadata = hostData === undefined ? undefined : clone(hostData);
            return enqueue(async () => {
                const {operation, receipt, nextTargetGeneration} = snapshot;
                const current = await readFile(fileFor(operation.sessionId));
                if (current?.committedOperationId === operation.operationId) {
                    return;
                }
                if (!current?.intent || JSON.stringify(current.intent.operation) !== JSON.stringify(operation) ||
                    receipt.kind !== "committed" || typeof receipt.baseline !== "string" ||
                    nextTargetGeneration !== operation.targetGeneration ||
                    current.watermark.targetGeneration !== operation.targetGeneration - 1) {
                    throw storeError("ESTALE", "Markdown target transaction does not match");
                }
                const target = {...operation.target, baseline: receipt.baseline, identity: receipt.identity ?? operation.target.identity};
                const revision = Math.max(current.watermark.revision, operation.revision);
                const newerDraft = current.draft && current.draft.revision > operation.revision;
                const record = {
                    ...current,
                    watermark: {sessionId: operation.sessionId, targetGeneration: nextTargetGeneration, revision},
                    draft: newerDraft ? {...current.draft!, target, targetGeneration: nextTargetGeneration} : undefined,
                    cleared: !newerDraft,
                    binding: target,
                    hostData: metadata ?? current.intent.hostData,
                    committedOperationId: operation.operationId,
                    intent: undefined,
                    updatedAt: Date.now(),
                };
                await write(record);
            });
        },
        abortSaveAs({sessionId, operationId}: {sessionId: string; operationId: string}) {
            if (!validId(sessionId) || !validId(operationId)) {
                throw storeError("EINVAL", "Invalid Markdown transaction identity");
            }
            return enqueue(async () => {
                const current = await readFile(fileFor(sessionId));
                if (!current?.intent) {
                    return;
                }
                if (current.intent.operation.operationId !== operationId) {
                    throw storeError("ESTALE", "Markdown target transaction does not match");
                }
                // 仅在宿主已确认目标未写入，且不存在进行中的写入后调用。
                await write({...current, intent: undefined, updatedAt: Date.now()});
            });
        },
        read(sessionId: string) {
            if (!validId(sessionId)) {
                throw storeError("EINVAL", "Invalid Markdown session identity");
            }
            return enqueue(() => readFile(fileFor(sessionId)));
        },
        finishSession(sessionId: string) {
            if (!validId(sessionId)) throw storeError("EINVAL", "Invalid Markdown session identity");
            return enqueue(async () => {
                const record = await readFile(fileFor(sessionId));
                // 调用方先关闭入口并排空在途操作，之后才允许回收这个会话的删除水位。
                if (record?.cleared && !record.draft && !record.intent) await io.unlink(fileFor(sessionId));
            });
        },
        discard(watermark: MarkdownDraftWatermark) {
            validateStamp(watermark);
            const expected = stamp(watermark);
            return enqueue(async () => {
                const record = await readFile(fileFor(expected.sessionId));
                if (!record) return;
                if (compare(record.watermark, expected) !== 0) throw storeError("ESTALE", "Markdown recovery changed");
                await io.unlink(fileFor(expected.sessionId));
            });
        },
        collectCompleted() {
            // 仅在宿主持有单实例锁、尚未恢复任何会话时调用，损坏记录仍原样保留。
            return enqueue(async () => {
                for (const name of await entries()) {
                    let record;
                    try {
                        record = await readFile(path.join(directory, name));
                    } catch {
                        continue;
                    }
                    if (record?.cleared && !record.draft && !record.intent) await io.unlink(path.join(directory, name));
                }
            });
        },
        list() {
            return enqueue(async () => {
                const records: MarkdownRecoveryRecord[] = [];
                const errors: {file: string; code: string}[] = [];
                for (const name of await entries()) {
                    try {
                        const record = await readFile(path.join(directory, name));
                        if (record?.draft || record?.intent) {
                            records.push(record);
                        }
                    } catch (caught) {
                        const error = caught as MarkdownIOError;

                        errors.push({file: name, code: error.code || "EIO"});
                    }
                }
                return {records, errors};
            });
        },
    };
};

export {createMarkdownRecoveryStore, RECOVERY_LIMITS};
export type MarkdownRecoveryStore = ReturnType<typeof createMarkdownRecoveryStore>;
