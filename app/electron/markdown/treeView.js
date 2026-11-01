const fs = require("node:fs/promises");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

const invalid = () => Object.assign(new Error("Invalid Markdown tree view"), {code: "EPROTO"});
const defaults = () => ({version: 1, width: 240, visible: true, roots: []});
const relativePath = value => typeof value === "string" && value.length <= 32768 &&
    !path.isAbsolute(value) && !value.split(/[\\/]/).some(part => part === ".." || part === ".") && !value.includes("\0");
const validate = data => {
    if (!data || data.version !== 1 || !Number.isInteger(data.width) || data.width < 180 || data.width > 480 ||
        typeof data.visible !== "boolean" || !Array.isArray(data.roots) || data.roots.length > 16) throw invalid();
    const ids = new Set();
    for (const root of data.roots) {
        if (!root || typeof root.id !== "string" || !/^[\w-]{1,128}$/.test(root.id) || ids.has(root.id) ||
            typeof root.path !== "string" || !path.isAbsolute(root.path) || typeof root.identity !== "string" ||
            !Array.isArray(root.expanded) || root.expanded.length > 256 || !root.expanded.every(relativePath)) throw invalid();
        ids.add(root.id);
    }
    return data;
};

const createMarkdownTreeView = directory => {
    const file = path.join(directory, "tree-view.json");
    let queue = Promise.resolve();
    const read = async () => {
        try {
            if ((await fs.stat(file)).size > 1024 * 1024) throw invalid();
            const bytes = await fs.readFile(file);
            if (bytes.length > 1024 * 1024) throw invalid();
            return validate(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
        } catch (error) {
            if (error.code === "ENOENT") return defaults();
            throw error;
        }
    };
    const update = operation => {
        const task = queue.then(async () => {
            const data = await read();
            const result = operation(data);
            validate(data);
            const serialized = JSON.stringify(data);
            if (Buffer.byteLength(serialized) > 1024 * 1024) throw invalid();
            await fs.mkdir(directory, {recursive: true, mode: 0o700});
            const temporary = file + "." + randomUUID() + ".tmp";
            let handle;
            try {
                handle = await fs.open(temporary, "wx", 0o600);
                await handle.writeFile(serialized);
                await handle.sync();
                await handle.close();
                handle = undefined;
                await fs.rename(temporary, file);
            } finally {
                if (handle) await handle.close().catch(() => undefined);
                await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
            }
            return result;
        });
        queue = task.catch(() => undefined);
        return task;
    };
    return {
        read: () => queue.then(read),
        root(descriptor) {
            return update(data => {
                const index = data.roots.findIndex(root => root.path === descriptor.path && root.identity === descriptor.identity);
                const root = index < 0 ? {id: randomUUID(), path: descriptor.path, identity: descriptor.identity, expanded: [""]} : data.roots.splice(index, 1)[0];
                data.roots.unshift(root);
                data.roots.length = Math.min(data.roots.length, 16);
                return {root: {...root, expanded: [...root.expanded]}, width: data.width, visible: data.visible};
            });
        },
        save(patch, descriptor) {
            return update(data => {
                if (patch.width !== undefined) data.width = patch.width;
                if (patch.visible !== undefined) data.visible = patch.visible;
                if (patch.expanded !== undefined) {
                    let root = data.roots.find(item => item.id === patch.rootId);
                    if (!root && descriptor?.id === patch.rootId) {
                        root = {...descriptor, expanded: []};
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

module.exports = {createMarkdownTreeView};
