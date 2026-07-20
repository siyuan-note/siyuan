import {fetchSyncPost} from "../../../util/fetch";
import {Constants} from "../../../constants";

const API = "/api/ai/agent";
const sessionRevisions = new Map<string, number>();
const sessionRuntimeRevisions = new Map<string, number>();
const sessionSaveQueues = new Map<string, Promise<SessionSaveResult>>();

interface SessionSaveResult {
    revision: number;
    session?: AgentSession;
}

async function waitForPendingSave(id: string) {
    const pending = sessionSaveQueues.get(id);
    if (pending) {
        try {
            await pending;
        } catch (e) {
            // 后续读取或删除以服务端当前状态为准。
        }
    }
}

// 标识发起者 app，后端 saveSession/removeSession 据此排除自身、向其他实例广播会话变更。
const APP_HEADER = {
    "Content-Type": "application/json",
    "X-SiYuan-App-ID": Constants.SIYUAN_APPID,
    "X-SiYuan-Agent-Checkpoint": "2",
};

export interface SessionIndexItem {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export interface SessionListResult {
    sessions: SessionIndexItem[];
    total: number;
    page: number;
    pageSize: number;
}

export interface AgentSession {
    id: string;
    title: string;
    titled?: boolean;
    model?: string;
    messages?: Array<{role: string; content: string; toolCalls?: Array<{name: string; arguments?: Record<string, unknown>; result?: string}>}>;
    entries?: Array<{
        id?: string;
        type: "user" | "thinking" | "assistant" | "confirm" | "question" | "snapshot" | "rollback";
        content?: string;
        blockHTML?: string;
        references?: Array<{id: string; title: string}>;
        editorContext?: {
            activeDocID?: string;
            activeDocTitle?: string;
            notebookID?: string;
            focusedBlockID?: string;
            selectedBlockIDs?: string[];
            visibleBlockIDs?: string[];
        };
        // thinking step：新格式只含 reasoning/reasoningContent/toolNames/content；
        // text/toolCalls 仅为读取老数据而保留为可选（渲染时归一化）。
        steps?: Array<{
            reasoning: string;
            reasoningContent: string;
            toolNames?: string[];
            content?: string;
            text?: string;
            toolCalls?: Array<{name: string; result?: string}>
        }>;
        reasoningContent?: string;
        toolCalls?: Array<{name: string; arguments?: Record<string, unknown>; result?: string; state?: string}>;
        duration?: number;
        timestamp?: number;
        name?: string;
        args?: Record<string, unknown>;
        confirmID?: string;
        status?: string;
        questionID?: string;
        questions?: Array<Record<string, unknown>>;
        answers?: string[];
        snapshotID?: string;
    }>;
    snapshots?: string[];
    promptTokens?: number;
    completionTokens?: number;
    totalDuration?: number;
    contextTokens?: number;
    contextTokenBreakdown?: Record<string, number>;
    contextCachedTokens?: number;
    contextLimit?: number;
    messageHistory?: string[];
    createdAt: number;
    updatedAt: number;
    revision?: number;
    expectedRevision?: number;
    commitTurnID?: string;
    lastCommittedTurnID?: string;
    recoveryTurnID?: string;
    recoveryState?: string;
    recoveryRevision?: number;
    agentRunning?: boolean;
}

function newSessionId(): string {
    return (window as any).Lute ? (window as any).Lute.NewNodeID() : Date.now().toString(36);
}

export const SessionStore = {
    async init(): Promise<SessionIndexItem[]> {
        const result = await this.list({page: 1, pageSize: 1});
        return result.sessions;
    },

    async list(opts?: {page?: number, pageSize?: number, keyword?: string}): Promise<SessionListResult> {
        const resp = await fetchSyncPost(API + "/lsSessions", {
            page: opts?.page || 1,
            pageSize: opts?.pageSize || 30,
            keyword: opts?.keyword || "",
        }) as {code: number, data: SessionListResult};
        if (resp && resp.code === 0) { return resp.data; }
        return {sessions: [], total: 0, page: 1, pageSize: opts?.pageSize || 30};
    },

    async load(id: string): Promise<AgentSession | null> {
        for (let attempt = 0; attempt < 3; attempt++) {
            await waitForPendingSave(id);
            const resp = await fetchSyncPost(API + "/getSession", {id}) as {code: number, data: AgentSession};
            if (!resp || resp.code !== 0) {
                return null;
            }
            const revision = resp.data.revision ?? 0;
            const runtimeRevision = resp.data.recoveryRevision ?? 0;
            const knownRevision = sessionRevisions.get(id) ?? 0;
            const knownRuntimeRevision = sessionRuntimeRevisions.get(id) ?? 0;
            if (revision < knownRevision ||
                (revision === knownRevision && runtimeRevision < knownRuntimeRevision)) {
                continue;
            }
            sessionRevisions.set(id, revision);
            sessionRuntimeRevisions.set(id, runtimeRevision);
            return resp.data;
        }
        // 连续写入期间若三次读取都落后于本地已知版本，则不返回旧数据覆盖界面。
        return null;
    },

    async save(session: AgentSession): Promise<SessionSaveResult> {
        const snapshot = JSON.parse(JSON.stringify(session)) as AgentSession;
        snapshot.updatedAt = Date.now();
        const baseRevision = snapshot.expectedRevision ?? sessionRevisions.get(snapshot.id) ?? snapshot.revision ?? 0;
        const previous = sessionSaveQueues.get(snapshot.id);
        const persist = async (expectedRevision: number) => {
            snapshot.expectedRevision = expectedRevision;
            const resp = await fetchSyncPost(API + "/saveSession", snapshot, APP_HEADER) as {
                code: number;
                msg?: string;
                data?: {revision?: number; session?: AgentSession};
            };
            if (!resp || resp.code !== 0) {
                throw new Error(resp?.msg || "Failed to save agent session");
            }
            const revision = resp.data?.revision ?? expectedRevision;
            sessionRevisions.set(snapshot.id, revision);
            if (snapshot.commitTurnID || snapshot.recoveryTurnID) {
                sessionRuntimeRevisions.set(snapshot.id, 0);
            }
            return {revision, session: resp.data?.session};
        };
        const save = previous ? previous.then((result) => persist(result.revision)) : persist(baseRevision);
        sessionSaveQueues.set(snapshot.id, save);
        try {
            return await save;
        } finally {
            if (sessionSaveQueues.get(snapshot.id) === save) {
                sessionSaveQueues.delete(snapshot.id);
            }
        }
    },

    async remove(id: string): Promise<void> {
        await waitForPendingSave(id);
        const resp = await fetchSyncPost(API + "/removeSession", {id}, APP_HEADER) as {code: number; msg?: string};
        if (!resp || resp.code !== 0) {
            throw new Error(resp?.msg || "Failed to remove agent session");
        }
        sessionRevisions.delete(id);
        sessionRuntimeRevisions.delete(id);
    },

    async rename(id: string, newTitle: string): Promise<void> {
        const session = await this.load(id);
        if (!session) { return; }
        session.title = newTitle;
        await this.save(session);
    },

    getRevision(id: string): number {
        return sessionRevisions.get(id) ?? 0;
    },

    newSessionId,
};
