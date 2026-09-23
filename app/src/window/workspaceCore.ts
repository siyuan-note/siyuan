export interface IWindowWorkspace {
    version: 1;
    id: string;
    name: string;
    deleted?: true;
}

export interface IWindowWorkspaceSnapshot {
    version: 1;
    time: number;
    layout: Config.TPersistedUILayoutItem;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

export const isWindowWorkspaceID = (value: unknown): value is string =>
    typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/.test(value);

export const isWindowWorkspace = (value: unknown): value is IWindowWorkspace =>
    isObject(value) && value.version === 1 && isWindowWorkspaceID(value.id) &&
    typeof value.name === "string" && !!value.name.trim() && value.deleted === undefined;

export const isWindowWorkspaceSnapshot = (value: unknown): value is IWindowWorkspaceSnapshot => {
    if (!isObject(value) || value.version !== 1 || typeof value.time !== "number" ||
        !Number.isFinite(value.time) || !isObject(value.layout) || value.layout.instance !== "Layout") {
        return false;
    }
    const pending: unknown[] = [value.layout];
    const visited = new Set<unknown>();
    while (pending.length) {
        const item = pending.pop();
        if (!isObject(item) || visited.has(item) || visited.size > 100000) {
            return false;
        }
        visited.add(item);
        for (const key of ["title", "lang", "icon", "docIcon", "notebookId", "blockId", "rootId", "path",
            "direction", "resize", "size", "type", "width", "height", "mode", "customModelType"]) {
            if (item[key] !== undefined && typeof item[key] !== "string") {
                return false;
            }
        }
        if (item.scrollAttr !== undefined) {
            const scroll = item.scrollAttr;
            if (item.instance !== "Editor" || !isObject(scroll) || typeof scroll.rootId !== "string" ||
                scroll.rootId !== item.rootId) {
                return false;
            }
            for (const key of ["startId", "endId", "focusId", "zoomInId"]) {
                if (scroll[key] !== undefined && typeof scroll[key] !== "string") {
                    return false;
                }
            }
            for (const key of ["scrollTop", "focusStart", "focusEnd"]) {
                if (scroll[key] !== undefined && (typeof scroll[key] !== "number" || !Number.isFinite(scroll[key]))) {
                    return false;
                }
            }
        }
        if (item.instance === "Layout" || item.instance === "Wnd") {
            const allowed = item.instance === "Layout" ? ["Layout", "Wnd"] : ["Tab"];
            if (!Array.isArray(item.children) || item.children.some(child => !isObject(child) ||
                !allowed.includes(String(child.instance)))) {
                return false;
            }
            for (const child of item.children) {
                pending.push(child);
            }
        } else if (item.instance === "Tab") {
            if (!isObject(item.children)) {
                return false;
            }
            if (["Layout", "Wnd", "Tab"].includes(String(item.children.instance))) {
                return false;
            }
            if (Object.keys(item.children).length) {
                pending.push(item.children);
            }
        } else if (!["Editor", "Asset", "Backlink", "Graph", "Outline", "Search", "Custom", "Bookmark", "Files", "Tag"].includes(String(item.instance))) {
            return false;
        }
    }
    return true;
};

// 串行写入窗口状态，等待中的更新只保留最新值，避免较早的请求覆盖新状态。
export class WindowWorkspaceWriter<T> {
    private pending?: T;
    private running?: Promise<boolean>;

    constructor(private readonly write: (value: T) => Promise<boolean>) {
    }

    save(value: T) {
        this.pending = value;
        if (!this.running) {
            this.running = Promise.resolve().then(() => this.flush());
        }
        return this.running;
    }

    private async flush() {
        try {
            while (this.pending !== undefined) {
                const value = this.pending;
                this.pending = undefined;
                let saved = false;
                try {
                    saved = await this.write(value);
                } catch (error) {
                    console.error(error);
                }
                if (!saved) {
                    this.pending = this.pending ?? value;
                    return false;
                }
            }
            return true;
        } finally {
            this.running = undefined;
        }
    }

    async stop() {
        this.pending = undefined;
        await this.running;
        this.pending = undefined;
    }
}
