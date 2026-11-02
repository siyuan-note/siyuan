import type {MarkdownIOError} from "./types";
import {createHash} from "node:crypto";
import {MarkdownDiskService} from "./disk";
import {encodeMarkdown} from "./codec";
import {createMarkdownRecoveryStore} from "./recoveryStore";
import type {MarkdownRecoveryStore} from "./recoveryStore";
import type {MarkdownEntry} from "./registry";
import type {MarkdownHostData, MarkdownSaveAsPreparation} from "./types";
import type {MarkdownBootstrap} from "../../src/markdown/bridge";
import type {MarkdownBlocked, MarkdownDraft, MarkdownDraftWatermark, MarkdownErrorCode, MarkdownFormat, MarkdownHost,
    MarkdownOperation, MarkdownReadRequest, MarkdownReadResult, MarkdownSaveAsCommit, MarkdownSaveAsCommitResult,
    MarkdownTarget, MarkdownWriteRequest, MarkdownWriteResult} from "../../src/markdown/contracts";

type HostOperation = {signature: string; promise?: Promise<MarkdownWriteResult>; result?: MarkdownWriteResult};
type HostTransfer = {
    sourceGeneration: number; targetGeneration: number; sourceHandle?: string; target: MarkdownTarget;
    persistence: "source" | "unknown" | "committed"; completed: Promise<MarkdownSaveAsCommitResult | undefined>;
};
export type MarkdownHostSession = {
    generation: number; target?: MarkdownTarget; operations: Map<string, HostOperation>;
    commits: Map<string, {signature: string; promise: Promise<MarkdownSaveAsCommitResult>}>;
    draftTasks: Set<Promise<void>>; readTasks: Set<Promise<MarkdownReadResult>>; lastWriteSequence: number;
    instanceId?: string; opening?: boolean; selecting?: boolean; closing?: boolean; crashed?: boolean;
    transferring?: boolean; transfer?: HostTransfer; committedOperationId?: string;
};
export type MarkdownInitial = Pick<MarkdownBootstrap, "sessionId" | "content" | "target" | "format" | "recovered">;

const protocolError = () => Object.assign(new Error("Invalid Markdown host operation"), {code: "EPROTO"});
const blocked = (code: MarkdownErrorCode): MarkdownBlocked => ({kind: "blocked", error: {code, recoverable: code !== "protocol"}});
const snapshot = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const counter = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const fingerprint = (request: unknown): string => createHash("sha256").update(JSON.stringify(request)).digest("hex");

// 对话框和系统文件入口调用 authorize*；渲染进程只能使用已授权的会话接口。
class MarkdownDesktopHost implements MarkdownHost {
    readonly disk: MarkdownDiskService;
    readonly recovery: MarkdownRecoveryStore;
    readonly sessions: Map<string, MarkdownHostSession>;
    readonly startup: Promise<void>;

    constructor({directory, disk = new MarkdownDiskService(), recovery}: {
        directory?: string; disk?: MarkdownDiskService; recovery?: MarkdownRecoveryStore;
    } = {}) {
        this.disk = disk;
        this.recovery = recovery || createMarkdownRecoveryStore(directory!);
        this.sessions = new Map();
        this.startup = this.recovery.collectCompleted();
        this.startup.catch(() => undefined);
    }

    createSession(): string {
        const sessionId = this.disk.createSession();
        this.sessions.set(sessionId, {generation: 0, target: undefined, operations: new Map(), commits: new Map(),
            draftTasks: new Set(), readTasks: new Set(), lastWriteSequence: 0});
        return sessionId;
    }

    session(sessionId: string): MarkdownHostSession {
        const session = this.sessions.get(sessionId);
        if (!session || session.closing) throw protocolError();
        return session;
    }

    operationSequence(request: Pick<MarkdownOperation, "sessionId" | "operationId">): number {
        const session = this.session(request.sessionId);
        const prefix = request.sessionId + ":";
        if (typeof request.operationId !== "string" || !request.operationId.startsWith(prefix)) throw protocolError();
        const parts = request.operationId.slice(prefix.length).split(":");
        const sequence = Number(parts[1]);
        if (parts.length !== 2 || !/^[\w-]{1,128}$/.test(parts[0]) ||
            !/^[1-9]\d*$/.test(parts[1]) || !Number.isSafeInteger(sequence) ||
            (session.instanceId && session.instanceId !== parts[0])) throw protocolError();
        session.instanceId = parts[0];
        return sequence;
    }

    hostData(sessionId: string, target?: MarkdownTarget): MarkdownHostData | undefined {
        if (!target) return undefined;
        const entry = this.disk.registry.get(sessionId, target.handle);
        return {selection: entry.descriptor.selection, path: entry.descriptor.path,
            identity: entry.descriptor.identity, baseline: entry.descriptor.baseline};
    }

    async authorizeOpen(sessionId: string, filePath: string) {
        const session = this.session(sessionId);
        if (session.target || session.opening) throw protocolError();
        session.opening = true;
        try {
            const result = await this.disk.authorizeOpen(sessionId, filePath);
            if (result.kind === "opened") session.target = result.target;
            return result;
        } finally {
            session.opening = false;
        }
    }

    async authorizeSaveAs(sessionId: string, filePath: string, format?: MarkdownFormat) {
        const session = this.session(sessionId);
        if (session.selecting || [...this.disk.registry.entries.values()].some(entry =>
            entry.sessionId === sessionId && entry.state !== "bound")) return blocked("protocol");
        session.selecting = true;
        try {
            return await this.disk.authorizeSaveAs(sessionId, filePath, format ?? session.target?.format);
        } finally {
            session.selecting = false;
        }
    }

    cancelAuthorizedSaveAs(sessionId: string, targetHandle: string): void {
        this.session(sessionId);
        const entry = this.disk.registry.get(sessionId, targetHandle);
        // 会话状态机接管预留后，只能由对应事务的 releaseSaveAs 释放。
        if (entry.state !== "reserved" || entry.operationId || entry.pending || entry.written) throw protocolError();
        if (!this.disk.releaseSaveAs({sessionId, target: this.disk.target(entry), reservationId: entry.reservationId!})) {
            throw protocolError();
        }
    }

    async read(request: MarkdownReadRequest): Promise<MarkdownReadResult> {
        let task: Promise<MarkdownReadResult> | undefined;
        let session: MarkdownHostSession | undefined;
        try {
            session = this.session(request.sessionId);
            this.operationSequence(request);
            if (session.transferring) return blocked("unavailable");
            if (session.generation !== request.targetGeneration || session.target?.handle !== request.target?.handle) {
                return blocked("protocol");
            }
            task = this.disk.read(snapshot(request));
            session.readTasks.add(task);
            return await task;
        } catch {
            return blocked("protocol");
        } finally {
            if (task) session!.readTasks.delete(task);
        }
    }

    async reserveSaveAs(request: Parameters<MarkdownHost["reserveSaveAs"]>[0]): ReturnType<MarkdownHost["reserveSaveAs"]> {
        try {
            this.operationSequence(request);
            const entry = this.disk.registry.get(request.sessionId, request.target?.handle);
            if (entry.state !== "reserved" || entry.pending || entry.written || entry.releasing ||
                (entry.operationId && entry.operationId !== request.operationId)) return blocked("protocol");
            encodeMarkdown("", request.format);
            entry.format = {...request.format};
            entry.operationId = request.operationId;
            return {kind: "reserved", reservation: {id: entry.reservationId!, target: this.disk.target(entry)}};
        } catch {
            return blocked("protocol");
        }
    }

    validateWrite(request: MarkdownWriteRequest): {session: MarkdownHostSession; sequence: number; entry: MarkdownEntry} {
        const session = this.session(request.sessionId);
        const sequence = this.operationSequence(request);
        if (!counter(request.targetGeneration) || !counter(request.revision) || typeof request.content !== "string" ||
            typeof request.expectedBaseline !== "string") throw protocolError();
        const entry = this.disk.registry.get(request.sessionId, request.target?.handle);
        if (entry.releasing) throw protocolError();
        const candidate = request.reservationId !== undefined;
        if (request.targetGeneration !== session.generation + (candidate ? 1 : 0) ||
            (!candidate && session.target?.handle !== request.target.handle) ||
            (candidate && (entry.reservationId !== request.reservationId || entry.operationId !== request.operationId))) {
            throw protocolError();
        }
        // 格式属于待写快照；未被前端采纳的重载结果不能改变后续保存可用的格式。
        encodeMarkdown("", request.target.format);
        if (request.target.identity !== this.disk.target(entry).identity) {
            throw protocolError();
        }
        return {session, sequence, entry};
    }

    async prepareSaveAs(request: MarkdownSaveAsPreparation): Promise<void> {
        const copy = snapshot(request);
        await this.startup;
        const {session, entry} = this.validateWrite(copy.operation);
        if (!copy.operation.reservationId || copy.previousTarget?.handle !== session.target?.handle) throw protocolError();
        if (entry.preparing) throw protocolError();
        entry.preparing = true;
        try {
            await this.recovery.prepareSaveAs(copy, {source: this.hostData(copy.operation.sessionId, session.target),
                candidate: this.hostData(copy.operation.sessionId, copy.operation.target)});
            entry.preparedOperation = fingerprint(copy.operation);
        } finally {
            entry.preparing = false;
        }
    }

    async write(request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        let copy: MarkdownWriteRequest;
        let session: MarkdownHostSession;
        let entry: MarkdownEntry;
        let signature: string;
        try {
            copy = snapshot(request);
            const validated = this.validateWrite(copy);
            session = validated.session;
            entry = validated.entry;
            signature = fingerprint(copy);
            const prior = session.operations.get(copy.operationId);
            if (prior) return prior.signature === signature ? (prior.promise || prior.result!) : blocked("protocol");
            if (validated.sequence <= session.lastWriteSequence ||
                (copy.reservationId && entry.preparedOperation !== signature)) return blocked("protocol");
            session.lastWriteSequence = validated.sequence;
        } catch {
            return blocked("protocol");
        }
        const operation: HostOperation = {signature};
        session.operations.set(copy.operationId, operation);
        operation.promise = (async () => {
            if (!copy.reservationId) {
                try {
                    await this.startup;
                    await this.recovery.putDraft({...copy, format: copy.target.format}, this.hostData(copy.sessionId, copy.target));
                } catch (caught) {
                    const error = caught as MarkdownIOError;

                    return blocked(error.code === "ENOSPC" ? "space" : "io");
                }
            }
            try {
                return await this.disk.write(copy);
            } catch {
                // 宿主实现抛错可能发生在替换之后，只能按结果不确定处理。
                entry.state = "indeterminate";
                return {kind: "indeterminate", error: {code: "io", recoverable: true}};
            }
        })();
        operation.result = await operation.promise;
        operation.promise = undefined;
        // 完成回执只保留摘要与少量最近结果，正文由恢复存储和当前事务持有。
        for (const [id, item] of session.operations) {
            if (session.operations.size <= 16) break;
            if (!item.promise && item.result?.kind !== "indeterminate" && id !== copy.operationId) session.operations.delete(id);
        }
        return operation.result;
    }

    async reconcileWrite(request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        try {
            const {session} = this.validateWrite(request);
            const operation = session.operations.get(request.operationId);
            if (!operation || operation.signature !== fingerprint(request)) return blocked("protocol");
            if (operation.promise) return await operation.promise;
            if (operation.result!.kind !== "indeterminate") return operation.result!;
            operation.result = await this.disk.reconcileWrite(snapshot(request));
            return operation.result;
        } catch {
            return {kind: "indeterminate", error: {code: "io", recoverable: true}};
        }
    }

    async commitSaveAs(request: MarkdownSaveAsCommit): Promise<MarkdownSaveAsCommitResult> {
        try {
            const copy = snapshot(request);
            const session = this.session(copy.operation.sessionId);
            const signature = fingerprint(copy);
            const prior = session.commits.get(copy.operation.operationId);
            if (prior) {
                if (prior.signature !== signature) return blocked("protocol");
                return await prior.promise;
            }
            const task = this.commitTransfer(copy);
            const commit = {signature, promise: task};
            session.commits.set(copy.operation.operationId, commit);
            const result = await task;
            // 失败保留磁盘意图，但允许同一操作再次尝试绑定落盘。
            if (result.kind !== "committed") session.commits.delete(copy.operation.operationId);
            return result;
        } catch {
            return {kind: "indeterminate", error: {code: "io", recoverable: true}};
        }
    }

    async commitTransfer(request: MarkdownSaveAsCommit): Promise<MarkdownSaveAsCommitResult> {
        let transfer: HostTransfer | undefined;
        let complete: ((result: MarkdownSaveAsCommitResult | undefined) => void) | undefined;
        let outcome: MarkdownSaveAsCommitResult | undefined;
        let session: MarkdownHostSession | undefined;
        try {
            const copy = snapshot(request);
            const {operation, receipt} = copy;
            session = this.session(operation.sessionId);
            const {entry} = this.validateWrite(operation);
            const written = session.operations.get(operation.operationId);
            if (!written || written.promise || written.signature !== fingerprint(operation) ||
                written.result?.kind !== "committed" || fingerprint(written.result) !== fingerprint(receipt) ||
                !entry.written || copy.nextTargetGeneration !== operation.targetGeneration ||
                copy.previousTarget?.handle !== session.target?.handle) throw protocolError();
            transfer = {sourceGeneration: session.generation, targetGeneration: operation.targetGeneration,
                sourceHandle: session.target?.handle, target: this.disk.target(entry),
                persistence: "source",
                completed: new Promise(resolve => { complete = resolve; })};
            session.transfer = transfer;
            session.transferring = true;
            // 旧目标在途读取完成后才释放其占用，迟到的正文结果由前端版本票据拒绝。
            await Promise.all(session.readTasks);
            // 绑定先落盘，再转换内存预留并释放原目标；失败时保留可幂等重试的事务。
            transfer.persistence = "unknown";
            await this.recovery.commitSaveAs(copy, this.hostData(operation.sessionId, operation.target));
            transfer.persistence = "committed";
            const target = this.disk.commitSaveAs({sessionId: operation.sessionId, target: operation.target,
                reservationId: operation.reservationId!, previousTarget: copy.previousTarget});
            session.target = target;
            session.generation = operation.targetGeneration;
            session.committedOperationId = operation.operationId;
            outcome = {kind: "committed", target};
            return outcome;
        } catch {
            if (transfer?.persistence === "unknown") {
                try {
                    const record = await this.recovery.read(request.operation.sessionId);
                    if (record?.committedOperationId === request.operation.operationId &&
                        record.watermark.targetGeneration === transfer.targetGeneration) transfer.persistence = "committed";
                    else if (record?.intent?.operation.operationId === request.operation.operationId &&
                        record.watermark.targetGeneration === transfer.sourceGeneration) transfer.persistence = "source";
                } catch { /* 不能核验持久化结果时，后续草稿不得假称已经保存。 */ }
            }
            outcome = {kind: "indeterminate", error: {code: "io", recoverable: true}};
            return outcome;
        } finally {
            if (transfer) session!.transferring = false;
            if (complete) complete(outcome);
        }
    }

    async releaseSaveAs({sessionId, reservationId, operationId}: Parameters<MarkdownHost["releaseSaveAs"]>[0]): Promise<void> {
        this.operationSequence({sessionId, operationId});
        const entry = [...this.disk.registry.entries.values()].find(value => value.sessionId === sessionId && value.reservationId === reservationId);
        if (!entry || entry.pending || entry.written || entry.preparing || entry.releasing || entry.state === "indeterminate" ||
            (entry.operationId && entry.operationId !== operationId)) throw protocolError();
        entry.releasing = true;
        try {
            await this.recovery.abortSaveAs({sessionId, operationId});
            if (!this.disk.releaseSaveAs({sessionId, target: this.disk.target(entry), reservationId})) throw protocolError();
        } finally {
            entry.releasing = false;
        }
    }

    async putDraft(draft: MarkdownDraft): Promise<void> {
        let copy = snapshot(draft);
        const session = this.session(draft.sessionId);
        return this.trackDraft(session, async () => {
            const transfer = session.transfer;
            let transferred = false;
            if (transfer && copy.targetGeneration === transfer.sourceGeneration && copy.target?.handle === transfer.sourceHandle) {
                await transfer.completed;
                if (transfer.persistence === "unknown") throw protocolError();
                if (transfer.persistence === "committed") {
                    copy = {...copy, targetGeneration: transfer.targetGeneration, target: transfer.target, format: transfer.target.format};
                    transferred = true;
                }
            }
            if (copy.targetGeneration < session.generation) return;
            if (!transferred && (copy.targetGeneration !== session.generation || copy.target?.handle !== session.target?.handle)) throw protocolError();
            await this.startup;
            await this.recovery.putDraft(copy, this.hostData(copy.sessionId, copy.target));
        });
    }

    trackDraft(session: MarkdownHostSession, operation: () => Promise<void>): Promise<void> {
        const task = Promise.resolve().then(operation);
        session.draftTasks.add(task);
        task.then(() => session.draftTasks.delete(task), () => session.draftTasks.delete(task));
        return task;
    }

    async clearDraft(watermark: MarkdownDraftWatermark): Promise<void> {
        const copy = snapshot(watermark);
        const session = this.session(copy.sessionId);
        if (copy.targetGeneration > session.generation) throw protocolError();
        return this.trackDraft(session, () => this.recovery.clearDraft(copy));
    }

    async listRecoveries() {
        await this.startup;
        const result = await this.recovery.list();
        return {records: result.records.filter(record => !this.sessions.has(record.watermark.sessionId) ||
            this.sessions.get(record.watermark.sessionId)!.crashed), errors: result.errors};
    }

    async restoreRecovery(id: string): Promise<MarkdownInitial> {
        await this.startup;
        const previousSession = this.sessions.get(id);
        if (previousSession && !previousSession.crashed) throw protocolError();
        if (previousSession) {
            await Promise.allSettled([
                ...[...previousSession.operations.values()].map(value => value.promise).filter(Boolean),
                ...previousSession.draftTasks, ...previousSession.readTasks,
                ...[...previousSession.commits.values()].map(value => value.promise),
            ]);
            try { await this.releaseSession({sessionId: id, targetGeneration: previousSession.generation}); } catch { /* 未决目标仍保留占用，恢复内容可另存为副本。 */ }
        }
        const record = await this.recovery.read(id);
        if (!record || (!record.draft && !record.intent)) throw protocolError();
        const operation = record.intent?.operation;
        const draft = record.draft && (!operation || record.draft.revision >= operation.revision) ? record.draft :
            {...operation!, format: operation!.target.format};
        const sessionId = this.createSession();
        let target: MarkdownTarget | undefined;
        try {
            // 只有权限、身份及基线均未改变的原文件才重新绑定；其他情况恢复为副本，绝不自动覆盖。
            if (!record.intent && record.hostData?.selection && draft.target) {
                const opened = await this.authorizeOpen(sessionId, record.hostData.selection);
                if (opened.kind === "opened") {
                    if (opened.target.baseline === draft.target.baseline) target = opened.target;
                    else {
                        this.disk.registry.release(this.disk.registry.get(sessionId, opened.target.handle));
                        this.session(sessionId).target = undefined;
                    }
                }
            }
            const revision = Math.max(1, draft.revision);
            await this.recovery.putDraft({sessionId, operationId: sessionId + ":recovery:1", targetGeneration: 0,
                revision, content: draft.content, format: draft.format, target},
            target ? this.hostData(sessionId, target) : {recoveredFrom: record.hostData});
            // 新会话的完整副本已落盘后才移除原记录，崩溃最多产生重复恢复项。
            await this.recovery.discard(record.watermark);
            return {sessionId, content: draft.content, format: draft.format, target,
                recovered: {revision, targetGeneration: 0}};
        } catch (error) {
            this.disk.closeSession(sessionId);
            this.sessions.delete(sessionId);
            throw error;
        }
    }

    async discardRecovery(id: string): Promise<void> {
        await this.startup;
        if (this.sessions.has(id)) throw protocolError();
        const record = await this.recovery.read(id);
        if (record) await this.recovery.discard(record.watermark);
    }

    async releaseSession({sessionId, targetGeneration}: Parameters<MarkdownHost["releaseSession"]>[0]): Promise<void> {
        const session = this.session(sessionId);
        const entries = [...this.disk.registry.entries.values()].filter(entry => entry.sessionId === sessionId);
        if (session.generation !== targetGeneration || session.opening || session.selecting ||
            [...session.operations.values()].some(operation => operation.promise) ||
            entries.some(entry => entry.pending || entry.state !== "bound")) throw protocolError();
        session.closing = true;
        try {
            await Promise.all(session.draftTasks);
            await this.recovery.finishSession(sessionId);
            if (!this.disk.closeSession(sessionId)) throw protocolError();
            this.sessions.delete(sessionId);
        } catch (error) {
            session.closing = false;
            throw error;
        }
    }
}

export {MarkdownDesktopHost};
