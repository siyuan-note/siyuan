import {fetchSyncPost} from "../../util/fetch";

const SESSIONS_DIR = "data/storage/ai/agent/sessions/";

interface SessionIndexItem {
    id: string;
    title: string;
    model?: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentSession {
    id: string;
    title: string;
    titled?: boolean;
    model?: string;
    entries?: Array<{
        type: "user" | "thinking" | "assistant";
        content?: string;
        reasoning?: string;
        text?: string;
        reasoningContent?: string;
        toolCalls?: Array<{name: string; arguments?: Record<string, unknown>; result?: string}>;
    }>;
    promptTokens?: number;
    completionTokens?: number;
    totalDuration?: number;
    messageHistory?: string[];
    createdAt: number;
    updatedAt: number;
}

function newSessionId(): string {
    return (window as any).Lute ? (window as any).Lute.NewNodeID() : Date.now().toString(36);
}

async function readJsonFile(path: string): Promise<any | null> {
    try {
        const r = await fetchSyncPost("/api/file/getFile", {path: path}) as any;
        if (!r) { return null; }
        return r;
    } catch (e) {
        return null;
    }
}

async function writeJsonFile(path: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, "\t");
    const fileName = path.split("/").pop() || "file.json";
    const file = new File([new Blob([content], {type: "application/json"})], fileName);
    const formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);
    formData.append("isDir", "false");
    await fetchSyncPost("/api/file/putFile", formData);
}

async function readDir(path: string): Promise<Array<{name: string; isDir: boolean; updated: number}> | null> {
    try {
        const r = await fetchSyncPost("/api/file/readDir", {path}) as any;
        if (r && r.code === 0 && r.data) { return r.data; }
    } catch (e) { /* readDir failed, directory may not exist */ }
    return null;
}

function getSessionFilePath(id: string): string {
    return SESSIONS_DIR + id + "/session.json";
}

export const SessionStore = {
    async init(): Promise<SessionIndexItem[]> {
        return await this.list();
    },

    async list(): Promise<SessionIndexItem[]> {
        const entries = await readDir(SESSIONS_DIR);
        if (!entries) { return []; }

        const list: SessionIndexItem[] = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry.isDir) { continue; }
            const session = await readJsonFile(getSessionFilePath(entry.name));
            if (session && session.id) {
                list.push({
                    id: session.id,
                    title: session.title || "AI Agent",
                    model: session.model || "",
                    createdAt: session.createdAt || entry.updated || Date.now(),
                    updatedAt: session.updatedAt || entry.updated || Date.now(),
                });
            }
        }
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        return list;
    },

    async load(id: string): Promise<AgentSession | null> {
        return await readJsonFile(getSessionFilePath(id));
    },

    async save(session: AgentSession): Promise<void> {
        session.updatedAt = Date.now();
        await writeJsonFile(getSessionFilePath(session.id), session);
    },

    async remove(id: string): Promise<void> {
        await fetchSyncPost("/api/file/removeFile", {path: SESSIONS_DIR + id + "/"});
    },

    async rename(id: string, newTitle: string): Promise<void> {
        const session = await this.load(id);
        if (!session) { return; }
        session.title = newTitle;
        await this.save(session);
    },

    newSessionId,
};
