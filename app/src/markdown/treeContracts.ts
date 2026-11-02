import type {MarkdownBootstrap} from "./bridge";
import type {MarkdownFailure} from "./contracts";

// 标识符均由宿主签发；目录授权仅用于列目录和打开 Markdown，不扩张图片访问权限。
export interface MarkdownTreeState {
    kind: "ready" | "empty" | "permission-required" | "blocked";
    rootId?: string;
    generation: number;
    rootName?: string;
    currentNodeId?: string;
    /** 从根目录到当前文件父目录的目录标识符。 */
    currentPath?: string[];
    expanded: string[];
    width: number;
    visible: boolean;
    error?: MarkdownFailure;
}

export interface MarkdownTreeNode {
    id: string;
    name: string;
    kind: "directory" | "file";
}

export interface MarkdownTreeLocation {
    rootId: string;
    generation: number;
    /** 根节点的标识符与 rootId 相同。 */
    nodeId: string;
}

export type MarkdownTreeListing = {
    kind: "listed";
    rootId: string;
    generation: number;
    nodeId: string;
    entries: MarkdownTreeNode[];
} | {kind: "blocked"; error: MarkdownFailure};

export type MarkdownTreeOpen = {kind: "ready"; ticket: string; sessionId: string} |
    {kind: "current" | "occupied"} | {kind: "blocked"; error: MarkdownFailure};

export interface MarkdownTreeView {
    rootId?: string;
    generation?: number;
    expanded?: string[];
    width?: number;
    visible?: boolean;
}

export interface MarkdownTreeBridge {
    state(): Promise<MarkdownTreeState>;
    list(location: MarkdownTreeLocation): Promise<MarkdownTreeListing>;
    chooseRoot(): Promise<MarkdownTreeState | {kind: "cancelled"}>;
    saveView(view: MarkdownTreeView): Promise<void>;
    /** 读取并预留候选文件，同时保留当前文档会话。 */
    prepareOpen(location: MarkdownTreeLocation): Promise<MarkdownTreeOpen>;
    /** 旧会话释放后幂等交换内存绑定。 */
    commitOpen(ticket: string): Promise<MarkdownBootstrap>;
    cancelOpen(ticket: string): Promise<void>;
}
