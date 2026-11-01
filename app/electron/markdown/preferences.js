const fs = require("node:fs/promises");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

const defaults = Object.freeze({mode: "ir", theme: "system", fontSize: 16});
const normalize = data => {
    if (!data || !["ir", "wysiwyg", "sv"].includes(data.mode) || !["system", "light", "dark"].includes(data.theme) ||
        !Number.isInteger(data.fontSize) || data.fontSize < 12 || data.fontSize > 32) throw new Error("Invalid Markdown preferences");
    return {mode: data.mode, theme: data.theme, fontSize: data.fontSize};
};

const createMarkdownPreferences = directory => {
    const file = path.join(directory, "preferences.json");
    let queue = Promise.resolve();
    const read = async () => {
        try {
            const stat = await fs.stat(file);
            if (stat.size > 4096) throw new Error("Invalid Markdown preferences size");
            const data = JSON.parse(await fs.readFile(file, "utf8"));
            if (data.version !== 1) throw new Error("Unsupported Markdown preferences version");
            return normalize(data);
        } catch (error) {
            if (error.code === "ENOENT") return {...defaults};
            throw error;
        }
    };
    return {
        read: () => queue.then(read),
        update(patch) {
            const copy = {...patch};
            const task = queue.then(async () => {
                const current = await read();
                const preferences = normalize({...current, ...copy});
                await fs.mkdir(directory, {recursive: true, mode: 0o700});
                const temporary = file + "." + randomUUID() + ".tmp";
                let handle;
                try {
                    handle = await fs.open(temporary, "wx", 0o600);
                    await handle.writeFile(JSON.stringify({version: 1, ...preferences}), "utf8");
                    await handle.sync();
                    await handle.close();
                    handle = undefined;
                    await fs.rename(temporary, file);
                    return preferences;
                } finally {
                    if (handle) await handle.close().catch(() => undefined);
                    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
                }
            });
            queue = task.catch(() => undefined);
            return task;
        },
    };
};

module.exports = {createMarkdownPreferences, defaults};
