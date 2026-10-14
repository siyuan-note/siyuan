import {setStorageVal} from "../../../protyle/util/compatibility";

export const AGENT_LAST_OPEN_KEY = "siyuan-agent-last-open";
export const AGENT_LAST_GREETING_KEY = "siyuan-agent-last-greeting";
const returnAfter = 7 * 24 * 60 * 60 * 1000;
type GreetingGroup = "First" | "Return" | "Morning" | "Day" | "Evening" | "Late";

export const getAgentGreetingGroup = (now: Date, lastOpen?: unknown): GreetingGroup => {
    if (typeof lastOpen !== "number" || !Number.isFinite(lastOpen) || lastOpen <= 0 || lastOpen > now.getTime()) {
        return "First";
    }
    if (now.getTime() - lastOpen >= returnAfter) {
        return "Return";
    }
    const hour = now.getHours();
    return hour >= 5 && hour < 11 ? "Morning" : hour >= 11 && hour < 18 ? "Day" :
        hour >= 18 && hour < 23 ? "Evening" : "Late";
};

export const pickAgentGreeting = (group: GreetingGroup, previous?: unknown, random = Math.random): string => {
    const count = group === "First" || group === "Return" ? 2 : 5;
    const keys = Array.from({length: count}, (_, index) => `agentWelcome${group}${index + 1}`)
        .filter(key => key !== previous);
    return keys[Math.floor(random() * keys.length)];
};

const readStorage = (key: string): unknown => {
    try {
        return window.siyuan.storage?.[key];
    } catch {
        return undefined;
    }
};

const writeStorage = (key: string, value: string | number) => {
    try {
        if (window.siyuan.storage) {
            window.siyuan.storage[key] = value;
            void Promise.resolve(setStorageVal(key, value)).catch(() => {});
        }
    } catch {
        // 问候不应因存储不可用而阻断聊天。
    }
};

export class AgentWelcomeGreeting {
    private visible = false;
    private opened = false;
    private group: GreetingGroup | undefined;
    private sessionID: string | undefined;
    private key = "";
    private previous: unknown;

    // 隐藏构造和重复可见通知不计为打开；先读取旧时间，再保存此次打开时间。
    public setVisible(visible: boolean, blank: boolean, now = new Date()): boolean {
        if (this.visible === visible) {
            return false;
        }
        this.visible = visible;
        if (!visible) {
            return false;
        }
        this.opened = true;
        this.group = blank ? getAgentGreetingGroup(now, readStorage(AGENT_LAST_OPEN_KEY)) : undefined;
        this.key = "";
        this.previous = readStorage(AGENT_LAST_GREETING_KEY) ?? this.previous;
        writeStorage(AGENT_LAST_OPEN_KEY, now.getTime());
        return blank;
    }

    public getKey(sessionID: string, now = new Date()): string {
        if (!this.opened || !this.visible) {
            return this.sessionID === sessionID ? this.key : "";
        }
        if (this.key && this.sessionID === sessionID) {
            return this.key;
        }
        const group = this.group || getAgentGreetingGroup(now, now.getTime());
        this.key = pickAgentGreeting(group, this.previous);
        this.previous = this.key;
        this.group = undefined;
        this.sessionID = sessionID;
        writeStorage(AGENT_LAST_GREETING_KEY, this.key);
        return this.key;
    }
}
