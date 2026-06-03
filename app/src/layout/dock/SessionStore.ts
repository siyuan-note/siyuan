import {fetchSyncPost} from "../../util/fetch";

const SESSIONS_DIR = "data/storage/ai/agent/sessions/";
const SESSIONS_INDEX = SESSIONS_DIR + "index.json";

interface SessionIndexItem {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentSession {
    id: string;
    title: string;
    messages: Array<{role: string; content: string}>;
    createdAt: number;
    updatedAt: number;
}

function newSessionId(): string {
    return (window as any).Lute ? (window as any).Lute.NewNodeID() : Date.now().toString(36);
}

async function readTextFile(path: string): Promise<string | null> {
    try {
        var r = await fetchSyncPost("/api/file/getFile", {path: path}) as any;
        console.log("[SS] getFile full response:", JSON.stringify(r));
        if (!r || r.code !== 0 || !r.data || r.data === null) {
            return null;
        }
        return r.data;
    } catch (e) {
        console.log("[SS] readText error:", path, e);
        return null;
    }
}

async function readJsonFile(path: string): Promise<any | null> {
    var text = await readTextFile(path);
    if (!text) { console.log("[SS] readJson null, path:", path); return null; }
    try { return JSON.parse(text); } catch (e) { console.log("[SS] readJson parse err:", path, e); return null; }
}

async function writeJsonFile(path: string, data: any): Promise<void> {
    var content = JSON.stringify(data, null, 2);
    var fileName = path.split("/").pop() || "file.json";
    var file = new File([new Blob([content], {type: "application/json"})], fileName);
    var formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);
    formData.append("isDir", "false");
    await fetchSyncPost("/api/file/putFile", formData);
}

async function ensureDir(): Promise<void> {
    var idx = await readJsonFile(SESSIONS_INDEX);
    if (idx && Array.isArray(idx)) { return; }

    try {
        var r = await fetchSyncPost("/api/file/readDir", {path: SESSIONS_DIR}) as any;
        if (r && r.code === 0) {
            await rebuildIndex();
            return;
        }
    } catch (e) {
        // readDir 失败，继续尝试创建
    }

    await writeJsonFile(SESSIONS_INDEX, []);
}

async function rebuildIndex(): Promise<void> {
    try {
        var r = await fetchSyncPost("/api/file/readDir", {path: SESSIONS_DIR}) as any;
        if (!r || r.code !== 0 || !r.data) {
            await writeJsonFile(SESSIONS_INDEX, []);
            return;
        }
        var entries = r.data as Array<{name: string; updated: number}>;
        var list: SessionIndexItem[] = [];
        for (var i = 0; i < entries.length; i++) {
            var name = entries[i].name;
            if (name === "index.json" || !name.endsWith(".json")) { continue; }
            var id = name.replace(".json", "");
            var session = await readJsonFile(SESSIONS_DIR + name);
            if (session && session.id && session.messages) {
                list.push({
                    id: id,
                    title: session.title || "AI Agent",
                    createdAt: session.createdAt || entries[i].updated || Date.now(),
                    updatedAt: session.updatedAt || entries[i].updated || Date.now(),
                });
            }
        }
        await writeJsonFile(SESSIONS_INDEX, list);
    } catch (e) {
        console.warn("[SessionStore] rebuildIndex failed:", e);
        await writeJsonFile(SESSIONS_INDEX, []);
    }
}

async function writeIndex(list: SessionIndexItem[]): Promise<void> {
    await writeJsonFile(SESSIONS_INDEX, list);
}

export const SessionStore = {
    async init(): Promise<void> {
        await ensureDir();
        var idx = await readJsonFile(SESSIONS_INDEX);
        if (!idx || !Array.isArray(idx)) {
            await rebuildIndex();
        }
    },

    async list(): Promise<SessionIndexItem[]> {
        var idx = await readJsonFile(SESSIONS_INDEX);
        return Array.isArray(idx) ? idx : [];
    },

    async load(id: string): Promise<AgentSession | null> {
        return await readJsonFile(SESSIONS_DIR + id + ".json");
    },

    async save(session: AgentSession): Promise<void> {
        session.updatedAt = Date.now();
        await writeJsonFile(SESSIONS_DIR + session.id + ".json", session);

        var list = await this.list();
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === session.id) {
                list[i].title = session.title;
                list[i].updatedAt = session.updatedAt;
                found = true;
                break;
            }
        }
        if (!found) {
            list.unshift({id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt});
        }
        await writeIndex(list);
    },

    async remove(id: string): Promise<void> {
        await fetchSyncPost("/api/file/removeFile", {path: SESSIONS_DIR + id + ".json"});
        var list = await this.list();
        list = list.filter(function (item: any) { return item.id !== id; });
        await writeIndex(list);
    },

    async rename(id: string, newTitle: string): Promise<void> {
        var session = await this.load(id);
        if (!session) { return; }
        session.title = newTitle;
        await this.save(session);
    },

    newSessionId: newSessionId,
};
