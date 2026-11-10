import {createMarkdownInstanceId} from "./identity";
import type {
    MarkdownBlocked, MarkdownCommitted, MarkdownConflict, MarkdownDraft, MarkdownEditorAdapter,
    MarkdownEditorSnapshot, MarkdownFailure, MarkdownFormat, MarkdownHost, MarkdownIndeterminate,
    MarkdownReservation, MarkdownTarget, MarkdownWriteRequest, MarkdownWriteResult,
} from "./contracts";

type SaveProblem = MarkdownBlocked | MarkdownConflict | MarkdownIndeterminate;

export interface MarkdownSessionState {
    readonly sessionId: string;
    readonly lifecycle: "open" | "closing" | "closed";
    readonly status: "view" | "draft" | "dirty" | "saving" | "saved" | "conflict" | "blocked" | "closed";
    readonly target?: MarkdownTarget;
    readonly targetGeneration: number;
    readonly content: string;
    readonly revision: number;
    readonly savedRevision: number;
    readonly draftRevision: number;
    readonly hasUnsavedChanges: boolean;
    readonly composing: boolean;
    readonly problem?: SaveProblem;
    readonly problemTargetHandle?: string;
    readonly recoveryError?: MarkdownFailure;
    readonly durability?: MarkdownCommitted["durability"];
}

export type MarkdownSaveAsResult = {kind: "saved" | "cancelled" | "blocked"} |
    {kind: "occupied"; sessionId: string};

interface PendingWrite {
    request: MarkdownWriteRequest;
    reservation?: MarkdownReservation;
    previousTarget?: MarkdownTarget;
    receipt?: MarkdownCommitted;
}

const ioFailure = (): MarkdownFailure => ({code: "io", recoverable: true});
const copyTarget = (target: MarkdownTarget): MarkdownTarget => Object.freeze({
    ...target,
    format: Object.freeze({...target.format}),
    capabilities: Object.freeze({...target.capabilities}),
});

export class MarkdownSession {
    private readonly host: MarkdownHost;
    private readonly sessionId: string;
    private readonly onChange?: (state: MarkdownSessionState) => void;
    private readonly instanceId: string;
    private readonly recovered: boolean;
    private target?: MarkdownTarget;
    private readonly defaultFormat: MarkdownFormat;
    private content: string;
    private revision = 0;
    private savedRevision: number;
    private targetGeneration = 0;
    private draftRevision = -1;
    private lifecycle: MarkdownSessionState["lifecycle"] = "open";
    private composing = false;
    private saving = false;
    private switching = false;
    private problem?: SaveProblem;
    private problemTargetHandle?: string;
    private recoveryError?: MarkdownFailure;
    private durability?: MarkdownCommitted["durability"];
    private pending?: PendingWrite;
    private operationSequence = 0;
    private reloadSequence = 0;
    private queue: Promise<void> = Promise.resolve();
    private saveTask?: Promise<void>;
    private saveRequested = false;
    private draftQueue: Promise<void> = Promise.resolve();
    private draftTask?: Promise<void>;
    private draftRequested = false;

    constructor(options: {
        sessionId: string;
        host: MarkdownHost;
        content?: string;
        target?: MarkdownTarget;
        format?: MarkdownFormat;
        // 宿主重新核验目标后载入恢复内容；恢复内容仍须用户选择重新加载、另存或明确覆盖。
        recovered?: {revision: number; targetGeneration: number};
        instanceId?: string;
        onChange?: (state: MarkdownSessionState) => void;
    }) {
        this.sessionId = options.sessionId;
        this.instanceId = options.instanceId ?? createMarkdownInstanceId();
        this.recovered = Boolean(options.recovered);
        this.host = options.host;
        this.content = options.content ?? "";
        this.target = options.target && copyTarget(options.target);
        this.defaultFormat = Object.freeze({...options.format ?? {bom: false, newline: "\n"}});
        this.savedRevision = options.target ? 0 : -1;
        if (options.recovered) {
            this.revision = options.recovered.revision;
            this.targetGeneration = options.recovered.targetGeneration;
            this.savedRevision = -1;
            this.draftRevision = this.revision;
            if (options.target) this.setProblem({kind: "conflict", baseline: options.target.baseline}, options.target.handle);
        }
        this.onChange = options.onChange;
    }

    getState(): MarkdownSessionState {
        let status: MarkdownSessionState["status"];
        if (this.lifecycle === "closed") status = "closed";
        else if (this.problem?.kind === "conflict") status = "conflict";
        else if (this.problem) status = "blocked";
        else if (this.saving || this.switching) status = "saving";
        else if (!this.target) status = "draft";
        else if (!this.target.writable && !this.isDirty()) status = "view";
        else status = this.isDirty() ? "dirty" : "saved";
        return Object.freeze({
            sessionId: this.sessionId, lifecycle: this.lifecycle, status,
            target: this.target, targetGeneration: this.targetGeneration,
            content: this.content, revision: this.revision, savedRevision: this.savedRevision,
            draftRevision: this.draftRevision, composing: this.composing,
            hasUnsavedChanges: this.isDirty(),
            problem: this.problem && Object.freeze({...this.problem}),
            problemTargetHandle: this.problemTargetHandle,
            recoveryError: this.recoveryError && Object.freeze({...this.recoveryError}), durability: this.durability,
        });
    }

    // edited 由编辑器适配层标记，初始化和展示规范化不能触发正文写回。
    updateEditor(snapshot: MarkdownEditorSnapshot): boolean {
        if (this.lifecycle !== "open") return false;
        return this.updateSnapshot(snapshot);
    }

    // Input intent precedes the editor's debounced Markdown snapshot. A read
    // started before that intent must not replace the still-unserialized DOM.
    invalidateReload(): void {
        this.reloadSequence++;
    }

    private updateSnapshot(snapshot: MarkdownEditorSnapshot): boolean {
        if (snapshot.composing && !this.composing) this.reloadSequence++;
        this.composing = snapshot.composing;
        if (snapshot.composing || !snapshot.edited || snapshot.content === this.content) {
            this.emit();
            return false;
        }
        this.content = snapshot.content;
        this.revision++;
        this.reloadSequence++;
        // 内容上限或编码错误只约束失败的快照；用户修正正文后可以提交新版本。
        if (this.problem?.kind === "blocked" && ["size", "encoding"].includes(this.problem.error.code) &&
            this.problemTargetHandle === this.target?.handle) this.setProblem();
        this.persistDraft();
        this.emit();
        return true;
    }

    save(): Promise<void> {
        if (this.lifecycle === "closed") return Promise.resolve();
        // 已确定失败的候选动作不阻断用户继续保存仍绑定的原文件。
        if (!this.switching && !this.pending && this.problem?.kind !== "indeterminate" &&
            this.problemTargetHandle !== this.target?.handle) this.setProblem();
        this.saveRequested = true;
        this.persistDraft();
        if (this.saveTask) return this.saveTask;
        const task = this.enqueue(async () => {
            while (this.saveRequested && this.lifecycle !== "closed" && !this.switching) {
                this.saveRequested = false;
                if (this.composing || this.problem || !this.target || !this.isDirty()) break;
                if (!this.target.writable) {
                    this.setProblem({kind: "blocked", error: {code: "readonly", recoverable: true}}, this.target.handle);
                    break;
                }
                const request = this.writeRequest(this.target, this.targetGeneration);
                this.saving = true;
                this.reloadSequence++;
                this.emit();
                const result = await this.write(request);
                this.saving = false;
                await this.acceptWrite({request}, result);
                if (!this.problem && this.isDirty()) this.saveRequested = true;
            }
            this.emit();
        });
        this.saveTask = task;
        void task.finally(() => {
            if (this.saveTask === task) this.saveTask = undefined;
        });
        return task;
    }

    async saveAs(target: MarkdownTarget, options: {signal?: AbortSignal; editor?: MarkdownEditorAdapter} = {}): Promise<MarkdownSaveAsResult> {
        if (this.lifecycle !== "open" || this.switching || this.pending || this.composing) return {kind: "blocked"};
        this.switching = true;
        this.reloadSequence++;
        this.emit();
        let outcome: MarkdownSaveAsResult = {kind: "blocked"};
        await this.enqueue(async () => {
            let reservation: MarkdownReservation;
            const operationId = this.nextOperation();
            try {
                // 入队前的旧写入可能刚进入结果不确定状态，必须先结算它才能释放原目标。
                if (this.pending) return;
                const result = await this.host.reserveSaveAs({
                    sessionId: this.sessionId, operationId, target, format: this.target?.format ?? this.defaultFormat,
                });
                if (result.kind === "occupied") {
                    outcome = result;
                    return;
                }
                if (result.kind === "blocked") {
                    this.setProblem(result, target.handle);
                    return;
                }
                reservation = result.reservation;
                const releaseUnused = () => this.release({reservation,
                    request: this.writeRequest(reservation.target, this.targetGeneration + 1, operationId, reservation.id)});
                if (options.signal?.aborted) {
                    await releaseUnused();
                    outcome = {kind: "cancelled"};
                    return;
                }
                if (options.editor) {
                    let captured: boolean;
                    try {
                        captured = await this.captureEditor(options.editor);
                    } catch (error) {
                        await releaseUnused();
                        throw error;
                    }
                    if (!captured) {
                        await releaseUnused();
                        return;
                    }
                }
                if (this.composing) {
                    await releaseUnused();
                    return;
                }
                const request = this.writeRequest({...reservation.target, format: this.target?.format ?? this.defaultFormat},
                    this.targetGeneration + 1, operationId, reservation.id);
                const pending: PendingWrite = {request, reservation, previousTarget: this.target};
                if (options.signal?.aborted || this.composing) {
                    await this.release(pending);
                    outcome = {kind: "cancelled"};
                    return;
                }
                try {
                    await this.host.prepareSaveAs({operation: request, previousTarget: this.target});
                } catch {
                    this.setProblem({kind: "blocked", error: ioFailure()}, target.handle);
                    await this.release(pending);
                    return;
                }
                if (options.signal?.aborted || this.composing) {
                    await this.release(pending);
                    outcome = {kind: "cancelled"};
                    return;
                }
                this.saving = true;
                const receipt = await this.write(request);
                this.saving = false;
                await this.acceptWrite(pending, receipt);
                if (this.pending) return;
                if (receipt.kind === "committed" && this.targetGeneration === request.targetGeneration) {
                    outcome = {kind: "saved"};
                    if (this.isDirty()) this.saveRequested = true;
                }
            } catch {
                this.setProblem({kind: "blocked", error: ioFailure()}, target.handle);
            } finally {
                this.switching = false;
                this.saving = false;
                this.emit();
            }
        });
        if (this.saveRequested && !this.problem) await this.save();
        return outcome;
    }

    async reload(options: {discardChanges?: boolean} = {}): Promise<boolean> {
        if (this.lifecycle !== "open" || !this.target || this.pending || this.composing || this.saving || this.switching) return false;
        const localDirty = this.isDirty();
        const ticket = {sequence: ++this.reloadSequence, generation: this.targetGeneration, revision: this.revision};
        const target = this.target;
        try {
            const result = await this.host.read({
                sessionId: this.sessionId, operationId: this.nextOperation(), targetGeneration: ticket.generation, target,
            });
            if (this.lifecycle !== "open" || ticket.sequence !== this.reloadSequence ||
                ticket.generation !== this.targetGeneration || ticket.revision !== this.revision ||
                this.composing || this.saving || this.switching) return false;
            if (result.kind === "blocked") {
                this.setProblem(result, target.handle);
                this.emit();
                return false;
            }
            if (result.target.handle !== target.handle || result.target.identity !== target.identity) {
                this.setProblem({kind: "blocked", error: {code: "identity-changed", recoverable: true}}, target.handle);
                this.emit();
                return false;
            }
            if (result.target.baseline === target.baseline && !(localDirty && options.discardChanges)) return false;
            if (localDirty && !options.discardChanges) {
                this.setProblem({kind: "conflict", baseline: result.target.baseline}, target.handle);
                this.emit();
                return false;
            }
            this.content = result.content;
            this.target = copyTarget(result.target);
            this.savedRevision = ++this.revision;
            this.setProblem();
            this.clearDraft(ticket.generation, this.revision);
            this.emit();
            return true;
        } catch {
            if (ticket.sequence === this.reloadSequence && this.lifecycle === "open") {
                this.setProblem({kind: "blocked", error: ioFailure()}, target.handle);
                this.emit();
            }
            return false;
        }
    }

    async retry(): Promise<void> {
        if (this.lifecycle !== "open" || this.switching || this.saving) return;
        if (this.pending) {
            await this.enqueue(async () => {
                const pending = this.pending;
                if (!pending) return;
                this.saving = true;
                try {
                    const result = pending.receipt ?? await this.host.reconcileWrite(pending.request);
                    await this.acceptWrite(pending, result);
                } catch {
                    this.setProblem({kind: "indeterminate", error: ioFailure()}, pending.request.target.handle);
                } finally {
                    this.saving = false;
                    this.emit();
                }
            });
        } else if (this.problem && this.problem.kind !== "indeterminate" &&
            (this.problemTargetHandle !== this.target?.handle ||
                this.problem.kind === "blocked" && this.problem.error.recoverable)) {
            this.setProblem();
        }
        if (!this.problem) await this.save();
    }

    // 覆盖只授权冲突提示中那个版本，后续外部变动仍由宿主条件写入拦截。
    async overwrite(expectedBaseline: string): Promise<boolean> {
        if (this.lifecycle !== "open" || this.problem?.kind !== "conflict" ||
            !this.problem.baseline || expectedBaseline !== this.problem.baseline || !this.target ||
            this.problemTargetHandle !== this.target.handle) return false;
        this.target = copyTarget({...this.target, baseline: expectedBaseline});
        this.setProblem();
        await this.save();
        return !this.problem;
    }

    async checkpoint(editor?: MarkdownEditorAdapter): Promise<boolean> {
        if (this.lifecycle !== "open" || editor && !await this.captureEditor(editor) || this.composing) return false;
        if (!this.isDirty() || this.draftRevision >= this.revision) return true;
        if (!this.draftTask) this.persistDraft();
        await this.draftQueue;
        return this.draftRevision >= this.revision;
    }

    async flush(editor?: MarkdownEditorAdapter): Promise<boolean> {
        if (this.lifecycle === "closed") return false;
        if (editor && !await this.captureEditor(editor)) return false;
        await this.save();
        await this.queue;
        await this.draftQueue;
        return true;
    }

    async close(editor?: MarkdownEditorAdapter): Promise<boolean> {
        if (this.lifecycle === "closed") return true;
        if (this.lifecycle === "closing") return false;
        this.lifecycle = "closing";
        this.reloadSequence++;
        this.emit();
        try {
            if (editor && !await this.captureEditor(editor)) {
                this.lifecycle = "open";
                this.emit();
                return false;
            }
        } catch {
            this.lifecycle = "open";
            this.setProblem({kind: "blocked", error: {code: "unavailable", recoverable: true}}, this.target?.handle);
            this.emit();
            return false;
        }
        if (this.composing) {
            this.lifecycle = "open";
            this.emit();
            return false;
        }
        await this.flush();
        if (this.pending || this.switching || (this.isDirty() && this.draftRevision < this.revision)) {
            this.lifecycle = "open";
            this.emit();
            return false;
        }
        try {
            await this.host.releaseSession({sessionId: this.sessionId, targetGeneration: this.targetGeneration});
        } catch {
            this.lifecycle = "open";
            this.setProblem({kind: "blocked", error: ioFailure()}, this.target?.handle);
            this.emit();
            return false;
        }
        this.lifecycle = "closed";
        this.emit();
        return true;
    }

    private isDirty(): boolean {
        return this.revision > this.savedRevision &&
            (Boolean(this.target) || this.revision > 0 || this.content.length > 0 || this.recovered);
    }

    private async captureEditor(editor: MarkdownEditorAdapter): Promise<boolean> {
        const {revision, targetGeneration, lifecycle} = this;
        const snapshot = await editor.flush();
        if (revision !== this.revision || targetGeneration !== this.targetGeneration || lifecycle !== this.lifecycle) return false;
        this.updateSnapshot(snapshot);
        return true;
    }

    private nextOperation(): string {
        return `${this.sessionId}:${this.instanceId}:${++this.operationSequence}`;
    }

    private writeRequest(target: MarkdownTarget, generation: number, operationId = this.nextOperation(), reservationId?: string): MarkdownWriteRequest {
        return Object.freeze({
            sessionId: this.sessionId, operationId, targetGeneration: generation,
            revision: this.revision, content: this.content, target: copyTarget(target),
            expectedBaseline: target.baseline, reservationId,
        });
    }

    private async write(request: MarkdownWriteRequest): Promise<MarkdownWriteResult> {
        try {
            return await this.host.write(request);
        } catch {
            return {kind: "indeterminate", error: ioFailure()};
        }
    }

    private async acceptWrite(pending: PendingWrite, result: MarkdownWriteResult): Promise<void> {
        if (result.kind === "indeterminate") {
            this.pending = pending;
            this.setProblem(result, pending.request.target.handle);
            return;
        }
        this.pending = undefined;
        if (result.kind !== "committed") {
            this.setProblem(result, pending.request.target.handle);
            if (pending.reservation) await this.release(pending);
            return;
        }
        const request = pending.request;
        if (pending.reservation) {
            let committed;
            try {
                committed = await this.host.commitSaveAs({
                    operation: request, receipt: result, previousTarget: pending.previousTarget,
                    nextTargetGeneration: request.targetGeneration,
                });
            } catch {
                committed = {kind: "indeterminate", error: ioFailure()} as const;
            }
            if (committed.kind !== "committed") {
                // 候选文件已写入，绑定落盘失败时仍须保留预留并幂等重试绑定提交。
                this.pending = {...pending, receipt: result};
                this.setProblem({kind: "indeterminate", error: committed.error}, request.target.handle);
                return;
            }
            const previousGeneration = this.targetGeneration;
            this.target = copyTarget(committed.target);
            this.targetGeneration = request.targetGeneration;
            this.draftRevision = -1;
            this.clearDraft(previousGeneration, request.revision);
        } else {
            if (request.targetGeneration !== this.targetGeneration || request.target.handle !== this.target?.handle ||
                this.lifecycle === "closed") return;
            this.target = copyTarget({...this.target, baseline: result.baseline});
        }
        this.savedRevision = request.revision;
        this.durability = result.durability;
        this.setProblem();
        this.clearDraft(this.targetGeneration, request.revision);
        if (this.isDirty()) this.persistDraft();
    }

    private async release(pending: PendingWrite): Promise<void> {
        await this.host.releaseSaveAs({
            sessionId: this.sessionId, operationId: pending.request.operationId, reservationId: pending.reservation!.id,
        });
    }

    private persistDraft(): void {
        if (this.lifecycle === "closed" || !this.isDirty()) return;
        this.draftRequested = true;
        if (this.draftTask) return;
        const task = this.draftQueue.then(async () => {
            while (this.draftRequested && this.lifecycle !== "closed") {
                this.draftRequested = false;
                if (!this.isDirty()) break;
                const draft: MarkdownDraft = Object.freeze({
                    sessionId: this.sessionId, operationId: this.nextOperation(),
                    targetGeneration: this.targetGeneration, revision: this.revision, content: this.content,
                    target: this.target, format: this.target?.format ?? this.defaultFormat,
                });
                try {
                    await this.host.putDraft(draft);
                    if (draft.targetGeneration === this.targetGeneration) {
                        this.draftRevision = Math.max(this.draftRevision, draft.revision);
                        this.recoveryError = undefined;
                    }
                } catch {
                    this.recoveryError = ioFailure();
                    break;
                }
                this.emit();
            }
        });
        this.draftTask = task;
        this.draftQueue = task;
        void task.finally(() => {
            if (this.draftTask === task) this.draftTask = undefined;
            if (this.draftRequested && this.isDirty()) this.persistDraft();
        });
    }

    private clearDraft(targetGeneration: number, revision: number): void {
        this.draftQueue = this.draftQueue.then(async () => {
            try {
                await this.host.clearDraft({sessionId: this.sessionId, targetGeneration, revision});
                if (targetGeneration === this.targetGeneration && this.draftRevision <= revision) this.draftRevision = -1;
            } catch {
                this.recoveryError = ioFailure();
            }
            this.emit();
        });
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const result = this.queue.then(work);
        this.queue = result.catch((): void => undefined);
        return result;
    }

    private emit(): void {
        this.onChange?.(this.getState());
    }

    private setProblem(problem?: SaveProblem, targetHandle?: string): void {
        this.problem = problem;
        this.problemTargetHandle = targetHandle;
    }
}
