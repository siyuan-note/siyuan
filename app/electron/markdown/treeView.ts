import type {MarkdownIOError} from "./types";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {createAvailableMarkdownId} from "../../src/markdown/identity";
import {createMarkdownTemporaryFile} from "./temporaryFile";
import type {MarkdownTreeView} from "../../src/markdown/treeContracts";

export type MarkdownTreeRoot = {id: string; path: string; identity: string; expanded: string[]};
export type MarkdownTreeViewData = {version: number; width: number; visible: boolean; roots: MarkdownTreeRoot[]};

const invalid = () => Object.assign(new Error("Invalid Markdown tree view"), {code: "EPROTO"});
const defaults = (): MarkdownTreeViewData => ({version: 1, width: 240, visible: true, roots: []});
const relativePath = (value: unknown): value is string => typeof value === "string" && value.length <= 32768 &&
    !path.isAbsolute(value) && !value.split(/[\\/]/).some(part => part === ".." || part === ".") && !value.includes("\0");
const validate = (value: unknown): MarkdownTreeViewData => {
    const data = value as MarkdownTreeViewData | undefined;
    if (!data || data.version !== 1 || !Number.isInteger(data.width) || data.width < 180 || data.width > 480 ||
        typeof data.visible !== "boolean" || !Array.isArray(data.roots) || data.roots.length > 16) throw invalid();
    const ids = new Set<string>();
    for (const root of data.roots) {
        if (!root || typeof root.id !== "string" || !/^[\w-]{1,128}$/.test(root.id) || ids.has(root.id) ||
            typeof root.path !== "string" || !path.isAbsolute(root.path) || typeof root.identity !== "string" ||
            !Array.isArray(root.expanded) || root.expanded.length > 256 || !root.expanded.every(relativePath)) throw invalid();
        ids.add(root.id);
    }
    return data;
};

const createMarkdownTreeView = (directory: string) => {
    const file = path.join(directory, "tree-view.json");
    let queue: Promise<unknown> = Promise.resolve();
    const read = async (): Promise<MarkdownTreeViewData> => {
        try {
            if ((await fs.stat(file)).size > 1024 * 1024) throw invalid();
            const bytes = await fs.readFile(file);
            if (bytes.length > 1024 * 1024) throw invalid();
            return validate(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
        } catch (caught) {
            const error = caught as MarkdownIOError;

            if (error.code === "ENOENT") return defaults();
            throw error;
        }
    };
    const update = <Result>(operation: (data: MarkdownTreeViewData) => Result): Promise<Result> => {
        const task = queue.then(async () => {
            const data = await read();
            const result = operation(data);
            validate(data);
            const serialized = JSON.stringify(data);
            if (Buffer.byteLength(serialized) > 1024 * 1024) throw invalid();
            await fs.mkdir(directory, {recursive: true, mode: 0o700});
            const staged = await createMarkdownTemporaryFile(file + ".", 0o600);
            const temporary = staged.path;
            let handle: fs.FileHandle | undefined = staged.handle;
            try {
                await handle.writeFile(serialized);
                await handle.sync();
                await handle.close();
                handle = undefined;
                await fs.rename(temporary, file);
            } finally {
                if (handle) await handle.close().catch(() => undefined);
                await fs.unlink(temporary).catch((error: MarkdownIOError) => { if (error.code !== "ENOENT") throw error; });
            }
            return result;
        });
        queue = task.catch(() => undefined);
        return task;
    };
    return {
        read: () => queue.then(read),
        root(descriptor: Pick<MarkdownTreeRoot, "path" | "identity">) {
            return update(data => {
                const index = data.roots.findIndex(root => root.path === descriptor.path && root.identity === descriptor.identity);
                const root = index < 0 ? {id: createAvailableMarkdownId(id => data.roots.some(root => root.id === id)),
                    path: descriptor.path, identity: descriptor.identity, expanded: [""]} : data.roots.splice(index, 1)[0];
                data.roots.unshift(root);
                data.roots.length = Math.min(data.roots.length, 16);
                return {root: {...root, expanded: [...root.expanded]}, width: data.width, visible: data.visible};
            });
        },
        save(patch: MarkdownTreeView, descriptor?: Omit<MarkdownTreeRoot, "expanded">) {
            return update(data => {
                if (patch.width !== undefined) data.width = patch.width;
                if (patch.visible !== undefined) data.visible = patch.visible;
                if (patch.expanded !== undefined) {
                    let root = data.roots.find(item => item.id === patch.rootId);
                    if (!root && descriptor?.id === patch.rootId) {
                        root = {...descriptor!, expanded: []};
                        data.roots.unshift(root);
                        data.roots.length = Math.min(data.roots.length, 16);
                    }
                    if (!root) throw invalid();
                    root.expanded = [...patch.expanded];
                }
                return {width: data.width, visible: data.visible};
            });
        },
    };
};

export {createMarkdownTreeView};
export type MarkdownTreeViewStore = ReturnType<typeof createMarkdownTreeView>;
