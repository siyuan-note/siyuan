import type {MarkdownErrorCode, MarkdownTarget, MarkdownWriteRequest} from "../../src/markdown/contracts";

export type MarkdownIOError<Code extends string = MarkdownErrorCode> = NodeJS.ErrnoException & {markdownCode?: Code};

// 真实路径仅用于宿主持久化和权限复核，不进入渲染进程的目标描述。
export type MarkdownHostData = {
    selection?: string;
    path?: string;
    identity?: string;
    baseline?: string;
    source?: MarkdownHostData;
    candidate?: MarkdownHostData;
    recoveredFrom?: MarkdownHostData;
};

export type MarkdownSaveAsPreparation = {operation: MarkdownWriteRequest; previousTarget?: MarkdownTarget};
