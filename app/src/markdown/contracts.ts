export interface MarkdownFormat {
    readonly bom: boolean;
    readonly newline: "\n" | "\r\n" | "\r";
}

export interface MarkdownCapabilities {
    readonly persistentPermission: boolean;
    readonly conditionalWrite: boolean;
    readonly atomicReplace: boolean;
    readonly coordinatedAccess: boolean;
}

export interface MarkdownTarget {
    readonly handle: string;
    readonly identity: string;
    readonly displayName: string;
    readonly baseline: string;
    readonly writable: boolean;
    readonly format: MarkdownFormat;
    readonly capabilities: MarkdownCapabilities;
}

export interface MarkdownOperation {
    readonly sessionId: string;
    readonly operationId: string;
    readonly targetGeneration: number;
    readonly revision: number;
    readonly content: string;
}

export type MarkdownErrorCode = "permission" | "readonly" | "offline" | "unavailable" | "deleted" |
    "identity-changed" | "encoding" | "size" | "space" | "io" | "protocol";

export interface MarkdownFailure {
    readonly code: MarkdownErrorCode;
    readonly recoverable: boolean;
}

export interface MarkdownBlocked {
    readonly kind: "blocked";
    readonly error: MarkdownFailure;
}

export interface MarkdownIndeterminate {
    readonly kind: "indeterminate";
    readonly error: MarkdownFailure;
}

export interface MarkdownConflict {
    readonly kind: "conflict";
    readonly baseline?: string;
}

export interface MarkdownCommitted {
    readonly kind: "committed";
    readonly baseline: string;
    readonly durability: "local" | "provider";
}

export type MarkdownWriteResult = MarkdownCommitted | MarkdownConflict | MarkdownBlocked | MarkdownIndeterminate;

export interface MarkdownWriteRequest extends MarkdownOperation {
    readonly target: MarkdownTarget;
    readonly expectedBaseline: string;
    readonly reservationId?: string;
}

export interface MarkdownReadRequest {
    readonly sessionId: string;
    readonly operationId: string;
    readonly targetGeneration: number;
    readonly target: MarkdownTarget;
}

export type MarkdownReadResult = {readonly kind: "read"; readonly content: string; readonly target: MarkdownTarget} |
    MarkdownBlocked;

export interface MarkdownReservation {
    readonly id: string;
    readonly target: MarkdownTarget;
}

export type MarkdownReservationResult = {readonly kind: "reserved"; readonly reservation: MarkdownReservation} |
    {readonly kind: "occupied"; readonly sessionId: string} | MarkdownBlocked;

export interface MarkdownDraft extends MarkdownOperation {
    readonly target?: MarkdownTarget;
    readonly format: MarkdownFormat;
}

export interface MarkdownDraftWatermark {
    readonly sessionId: string;
    readonly targetGeneration: number;
    readonly revision: number;
}

export interface MarkdownSaveAsCommit {
    readonly operation: MarkdownWriteRequest;
    readonly receipt: MarkdownCommitted;
    readonly previousTarget?: MarkdownTarget;
    readonly nextTargetGeneration: number;
}

export type MarkdownSaveAsCommitResult = {readonly kind: "committed"; readonly target: MarkdownTarget} |
    MarkdownBlocked | MarkdownIndeterminate;

export interface MarkdownHost {
    // 内容与基线必须来自同一次一致性读取，不能把随后读取的版本拼到先前内容上。
    read(request: MarkdownReadRequest): Promise<MarkdownReadResult>;
    // 未确认结果的异常必须返回 indeterminate；blocked 表示本次写入确定没有提交。
    write(request: MarkdownWriteRequest): Promise<MarkdownWriteResult>;
    // 仅核验既有操作的结果，不能再次提交内容。
    reconcileWrite(request: MarkdownWriteRequest): Promise<MarkdownWriteResult>;
    reserveSaveAs(request: {sessionId: string; operationId: string; target: MarkdownTarget; format: MarkdownFormat}): Promise<MarkdownReservationResult>;
    // 写前持久化操作意图；崩溃恢复应保留原目标、候选目标、修订和预留之间的关系。
    prepareSaveAs(request: {operation: MarkdownWriteRequest; previousTarget?: MarkdownTarget}): Promise<void>;
    // 持久化绑定后才能释放原目标；同一操作重复调用必须幂等。
    commitSaveAs(request: MarkdownSaveAsCommit): Promise<MarkdownSaveAsCommitResult>;
    // 宿主必须拒绝释放仍可能产生写入结果的预留。
    releaseSaveAs(request: {sessionId: string; reservationId: string; operationId: string}): Promise<void>;
    // 草稿更新与删除共享持久化单调水位，迟到的旧更新不能复活已经清理的草稿。
    putDraft(draft: MarkdownDraft): Promise<void>;
    clearDraft(watermark: MarkdownDraftWatermark): Promise<void>;
    releaseSession(request: {sessionId: string; targetGeneration: number}): Promise<void>;
}

export interface MarkdownEditorSnapshot {
    readonly content: string;
    readonly edited: boolean;
    readonly composing: boolean;
}

export interface MarkdownEditorAdapter {
    // 应刷新编辑器内部延迟事件，返回最新已提交输入；组词中的内容不能当成已提交内容。
    flush(): MarkdownEditorSnapshot | Promise<MarkdownEditorSnapshot>;
}
