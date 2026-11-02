import type {MarkdownIOError} from "./types";
import * as fs from "node:fs/promises";
import {watch} from "node:fs";
import * as path from "node:path";
import {createMarkdownInstanceId} from "../../src/markdown/identity";
import {inside} from "./resources";
import type {BigIntStats, FSWatcher} from "node:fs";
import type {MarkdownErrorCode, MarkdownFailure} from "../../src/markdown/contracts";
import type {MarkdownTreeListing, MarkdownTreeLocation, MarkdownTreeNode, MarkdownTreeState, MarkdownTreeView} from "../../src/markdown/treeContracts";
import type {MarkdownTreeRoot, MarkdownTreeViewStore} from "./treeView";

type TreeEntry = MarkdownTreeNode & {relative: string; selection: string; path: string; identity: string};

const identity = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;
const fail = (code: MarkdownErrorCode) => Object.assign(new Error("Markdown directory unavailable"), {markdownCode: code});
const failure = (caught: unknown): MarkdownFailure => {
    const error = caught as MarkdownIOError;
    return {code: error.markdownCode || ({EPROTO: "protocol", ENOENT: "deleted", EACCES: "permission", EPERM: "permission"} as
        Record<string, MarkdownErrorCode>)[error.code ?? ""] || "io", recoverable: true};
};
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
const compare = (left: MarkdownTreeNode, right: MarkdownTreeNode): number => (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1) ||
    collator.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

class MarkdownTree {
    readonly view: MarkdownTreeViewStore;
    readonly fs: typeof fs;
    readonly notify: () => void;
    readonly watchDirectory: typeof watch;
    generation: number;
    rootSequence: number;
    width: number;
    visible: boolean;
    readonly nodes: Map<string, TreeEntry>;
    readonly nodeIds = new Map<string, string>();
    readonly issuedIds = new Set<string>();
    readonly createId: () => string;
    expanded: string[];
    readonly watchers: Map<string, FSWatcher>;
    closed: boolean;
    root?: MarkdownTreeRoot & {selection: string};
    timer?: NodeJS.Timeout;

    constructor({view, notify = () => {}, fileSystem = fs, watchDirectory = watch, createId = createMarkdownInstanceId}: {
        view: MarkdownTreeViewStore; notify?: () => void; fileSystem?: typeof fs; watchDirectory?: typeof watch;
        createId?: () => string;
    }) {
        this.view = view;
        this.createId = createId;
        this.fs = fileSystem;
        this.notify = notify;
        this.watchDirectory = watchDirectory;
        this.generation = 0;
        this.rootSequence = 0;
        this.width = 240;
        this.visible = true;
        this.nodes = new Map();
        this.expanded = [];
        this.watchers = new Map();
        this.closed = false;
    }

    id(relative: string): string {
        if (!relative) return this.root!.id;
        const previous = this.nodeIds.get(relative);
        if (previous) return previous;
        if (this.nodeIds.size >= 9999) throw fail("size");
        for (let attempt = 0; attempt < 32; attempt++) {
            const id = this.createId();
            if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw fail("protocol");
            if (this.issuedIds.has(id)) continue;
            this.issuedIds.add(id);
            this.nodeIds.set(relative, id);
            return id;
        }
        throw fail("io");
    }

    async setRoot(selection: string): Promise<void> {
        const sequence = ++this.rootSequence;
        const canonical = await this.fs.realpath(selection);
        const stat = await this.fs.stat(canonical, {bigint: true});
        if (!stat.isDirectory()) throw fail("permission");
        const saved = await this.view.root({path: canonical, identity: identity(stat)});
        if (this.closed || sequence !== this.rootSequence) throw fail("unavailable");
        this.stopWatches();
        this.root = {...saved.root, selection, path: canonical};
        this.generation++;
        this.nodes.clear();
        this.nodeIds.clear();
        this.issuedIds.clear();
        this.issuedIds.add(this.root.id);
        this.width = saved.width;
        this.visible = saved.visible;
        this.expanded = [];
        this.nodes.set(this.root.id, {id: this.root.id, relative: "", name: path.basename(canonical) || canonical,
            kind: "directory", selection, path: canonical, identity: identity(stat)});
        for (const relative of saved.root.expanded) {
            if (this.closed || sequence !== this.rootSequence) throw fail("unavailable");
            try {
                const node = await this.resolve(relative);
                if (this.closed || sequence !== this.rootSequence) throw fail("unavailable");
                if (node.kind === "directory") { this.nodes.set(node.id, node); this.expanded.push(node.id); }
            } catch { /* 已删除目录不影响其余展开状态恢复。 */ }
        }
        if (this.closed || sequence !== this.rootSequence) throw fail("unavailable");
        this.updateWatches();
    }

    async checkRoot(): Promise<void> {
        if (!this.root || this.closed) throw fail("unavailable");
        const canonical = await this.fs.realpath(this.root.selection);
        const stat = await this.fs.stat(canonical, {bigint: true});
        if (canonical !== this.root.path || !stat.isDirectory() || identity(stat) !== this.root.identity) throw fail("identity-changed");
    }

    async resolve(relative: string): Promise<TreeEntry> {
        if (!this.root || typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\0")) throw fail("protocol");
        const root = this.root;
        const generation = this.generation;
        const parts = relative ? relative.split(path.sep) : [];
        if (parts.length > 64 || parts.some(part => !part || part === "." || part === "..")) throw fail("size");
        await this.checkRoot();
        if (root !== this.root || generation !== this.generation || this.closed) throw fail("unavailable");
        let selection = root.path;
        const ancestors = new Set([root.identity]);
        let canonical = selection;
        let stat = await this.fs.stat(canonical, {bigint: true});
        for (let index = 0; index < parts.length; index++) {
            selection = path.join(selection, parts[index]);
            canonical = await this.fs.realpath(selection);
            if (!inside(root.path, canonical)) throw fail("permission");
            stat = await this.fs.stat(canonical, {bigint: true});
            if (stat.isDirectory()) {
                if (ancestors.has(identity(stat))) throw fail("permission");
                ancestors.add(identity(stat));
            } else if (!stat.isFile() || index !== parts.length - 1) throw fail("permission");
        }
        if (!stat.isDirectory() && !/\.(md|markdown)$/i.test(selection)) throw fail("permission");
        if (root !== this.root || generation !== this.generation || this.closed) throw fail("unavailable");
        return {id: this.id(relative), relative, name: parts.at(-1) || path.basename(canonical) || canonical,
            kind: stat.isDirectory() ? "directory" : "file", selection, path: canonical, identity: identity(stat)};
    }

    location(location: MarkdownTreeLocation): TreeEntry {
        if (!location || this.closed || location.rootId !== this.root?.id || location.generation !== this.generation ||
            typeof location.nodeId !== "string" || !this.nodes.has(location.nodeId)) throw fail("protocol");
        return this.nodes.get(location.nodeId)!;
    }

    async checked(location: MarkdownTreeLocation): Promise<TreeEntry> {
        const original = this.location(location);
        const current = await this.resolve(original.relative);
        this.location(location);
        if (current.path !== original.path || current.identity !== original.identity || current.kind !== original.kind) throw fail("identity-changed");
        return current;
    }

    async list(location: MarkdownTreeLocation): Promise<MarkdownTreeListing> {
        try {
            const directory = await this.checked(location);
            if (directory.kind !== "directory") throw fail("protocol");
            const entries: TreeEntry[] = [];
            let total = 0;
            const opened = await this.fs.opendir(directory.path);
            try {
                for await (const item of opened) {
                    if (++total > 10000) throw fail("size");
                    if (!item.isDirectory() && !item.isSymbolicLink() && !/\.(md|markdown)$/i.test(item.name)) continue;
                    try {
                        const node = await this.resolve(path.join(directory.relative, item.name));
                        entries.push(node);
                    } catch (caught) {
                        const error = caught as MarkdownIOError;

                        if (error.markdownCode === "size") throw error;
                        if (!["ENOENT", "EACCES", "EPERM"].includes(error.code ?? "") && !["permission"].includes(error.markdownCode ?? "")) throw error;
                    }
                }
            } finally { await opened.close().catch((error: MarkdownIOError) => { if (error.code !== "ERR_DIR_CLOSED") throw error; }); }
            const after = await this.checked(location);
            if (after.identity !== directory.identity) throw fail("identity-changed");
            const names = new Set(entries.map(node => node.relative));
            const obsolete: string[] = [];
            for (const [id, node] of this.nodes) {
                if (!node.relative || node.relative === directory.relative) continue;
                const relative = path.relative(directory.relative || ".", node.relative);
                if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) continue;
                const child = path.join(directory.relative, relative.split(path.sep)[0]);
                if (!names.has(child)) obsolete.push(id);
            }
            const added = entries.filter(node => !this.nodes.has(node.id)).length;
            if (this.nodes.size - obsolete.length + added > 10000) throw fail("size");
            for (const id of obsolete) this.nodes.delete(id);
            for (const node of entries) this.nodes.set(node.id, node);
            if (obsolete.length) {
                this.expanded = this.expanded.filter(id => this.nodes.has(id));
                this.updateWatches();
            }
            return {kind: "listed", rootId: location.rootId, generation: location.generation, nodeId: location.nodeId,
                entries: entries.sort(compare).map(({id, name, kind}) => ({id, name, kind}))};
        } catch (error) { return {kind: "blocked", error: failure(error)}; }
    }

    async file(location: MarkdownTreeLocation): Promise<TreeEntry> {
        const node = await this.checked(location);
        if (node.kind !== "file") throw fail("protocol");
        return node;
    }

    async state(currentPath?: string): Promise<MarkdownTreeState> {
        const basic = () => ({generation: this.generation, expanded: [...this.expanded], width: this.width, visible: this.visible});
        try {
            if (!this.root) {
                const saved = await this.view.read();
                this.width = saved.width;
                this.visible = saved.visible;
                return {kind: "empty", ...basic()};
            }
            const root = this.root;
            const generation = this.generation;
            await this.checkRoot();
            const result: MarkdownTreeState = {kind: "ready", ...basic(), rootId: root.id, rootName: path.basename(root.path) || root.path};
            if (currentPath && inside(root.path, currentPath)) {
                const relative = path.relative(root.path, currentPath);
                if (relative) {
                    try {
                        const file = await this.resolve(relative);
                        const parents: string[] = [];
                        const pieces = relative.split(path.sep);
                        for (let index = 0; index < pieces.length; index++) {
                            const node = await this.resolve(pieces.slice(0, index).join(path.sep));
                            if (root !== this.root || generation !== this.generation || this.closed) throw fail("unavailable");
                            if (!this.nodes.has(node.id) && this.nodes.size >= 10000) throw fail("size");
                            this.nodes.set(node.id, node);
                            parents.push(node.id);
                        }
                        if (file.kind === "file") {
                            if (!this.nodes.has(file.id) && this.nodes.size >= 10000) throw fail("size");
                            this.nodes.set(file.id, file);
                            result.currentNodeId = file.id;
                            result.currentPath = parents;
                        }
                    } catch (caught) {
                        const error = caught as MarkdownIOError;

                        // 当前文件被删除或撤权时，仍允许导航其余可访问文件。
                        if (!["ENOENT", "EACCES", "EPERM"].includes(error.code ?? "") &&
                            !["permission", "identity-changed"].includes(error.markdownCode ?? "")) throw error;
                    }
                }
            }
            await this.checkRoot();
            if (root !== this.root || generation !== this.generation || this.closed) throw fail("unavailable");
            return result;
        } catch (error) { return {kind: "blocked", ...basic(), error: failure(error)}; }
    }

    async saveView(patch: MarkdownTreeView): Promise<void> {
        if (!patch || Object.keys(patch).some(key => !["rootId", "generation", "expanded", "width", "visible"].includes(key))) throw fail("protocol");
        const copy = {...patch};
        if (copy.width !== undefined && (!Number.isInteger(copy.width) || copy.width < 180 || copy.width > 480)) throw fail("protocol");
        if (copy.visible !== undefined && typeof copy.visible !== "boolean") throw fail("protocol");
        if (copy.expanded !== undefined) {
            this.location({rootId: copy.rootId!, generation: copy.generation!, nodeId: copy.rootId!});
            if (!Array.isArray(copy.expanded) || copy.expanded.length > 256 || new Set(copy.expanded).size !== copy.expanded.length) throw fail("protocol");
            copy.expanded = copy.expanded.map(id => {
                const node = this.nodes.get(id);
                if (!node || node.kind !== "directory") throw fail("protocol");
                return node.relative;
            });
        }
        const root = this.root;
        const saved = await this.view.save(copy, root ? {id: root.id, path: root.path, identity: root.identity} : undefined);
        this.width = saved.width;
        this.visible = saved.visible;
        if (copy.expanded && copy.rootId === this.root?.id && copy.generation === this.generation) this.expanded = copy.expanded.map(relative => this.id(relative));
        this.updateWatches();
    }

    updateWatches(): void {
        this.stopWatches();
        if (this.closed || !this.root) return;
        const generation = this.generation;
        const changed = () => {
            if (this.closed || generation !== this.generation) return;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => { if (!this.closed && generation === this.generation) this.notify(); }, 150);
            this.timer.unref?.();
        };
        for (const id of new Set([this.root.id, ...this.expanded])) {
            const node = this.nodes.get(id);
            if (!node || node.kind !== "directory") continue;
            try {
                const watcher = this.watchDirectory(node.path, changed);
                watcher.on("error", changed);
                this.watchers.set(id, watcher);
            } catch { /* 聚焦刷新与每次文件操作仍会核验不可观察的目录。 */ }
        }
    }

    stopWatches(): void { for (const watcher of this.watchers.values()) watcher.close(); this.watchers.clear(); clearTimeout(this.timer); }
    close(): void { this.closed = true; this.rootSequence++; this.stopWatches(); }
}

export {MarkdownTree, failure as treeFailure};
