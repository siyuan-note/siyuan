import {fetchSyncPost} from "../../../util/fetch";
import {Constants} from "../../../constants";

const API = "/api/ai/agent";

// 标识发起者 app，后端 saveSession/removeSession 据此排除自身、向其他实例广播会话变更。
const APP_HEADER = {"X-SiYuan-App-ID": Constants.SIYUAN_APPID};

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
        toolCalls?: Array<{name: string; arguments?: Record<string, unknown>; result?: string}>;
        duration?: number;
        confirmName?: string;
        confirmArgs?: Record<string, unknown>;
        confirmID?: string;
        confirmStatus?: string;
        questionID?: string;
        questions?: Array<Record<string, unknown>>;
        questionStatus?: string;
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
        const resp = await fetchSyncPost(API + "/getSession", {id}) as {code: number, data: AgentSession};
        return (resp && resp.code === 0) ? resp.data : null;
    },

    async save(session: AgentSession): Promise<void> {
        session.updatedAt = Date.now();
        await fetchSyncPost(API + "/saveSession", session, APP_HEADER);
    },

    async remove(id: string): Promise<void> {
        await fetchSyncPost(API + "/removeSession", {id}, APP_HEADER);
    },

    async rename(id: string, newTitle: string): Promise<void> {
        const session = await this.load(id);
        if (!session) { return; }
        session.title = newTitle;
        await this.save(session);
    },

    newSessionId,
};
