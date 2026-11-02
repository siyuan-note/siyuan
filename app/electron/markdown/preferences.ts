import * as fs from "node:fs/promises";
import * as path from "node:path";
import {createMarkdownTemporaryFile} from "./temporaryFile";
import type {MarkdownPreferences} from "../../src/markdown/bridge";
import type {MarkdownIOError} from "./types";

const defaults: Readonly<MarkdownPreferences> = Object.freeze({mode: "ir", theme: "system", fontSize: 16});
const normalize = (value: unknown): MarkdownPreferences => {
    const data = value as Record<string, unknown> | undefined;
    if (!data || typeof data.mode !== "string" || !["ir", "wysiwyg", "sv"].includes(data.mode) ||
        typeof data.theme !== "string" || !["system", "light", "dark"].includes(data.theme) ||
        typeof data.fontSize !== "number" || !Number.isInteger(data.fontSize) || data.fontSize < 12 || data.fontSize > 32) {
        throw new Error("Invalid Markdown preferences");
    }
    return {mode: data.mode as MarkdownPreferences["mode"], theme: data.theme as MarkdownPreferences["theme"], fontSize: data.fontSize};
};

const createMarkdownPreferences = (directory: string) => {
    const file = path.join(directory, "preferences.json");
    let queue: Promise<unknown> = Promise.resolve();
    const read = async (): Promise<MarkdownPreferences> => {
        try {
            const stat = await fs.stat(file);
            if (stat.size > 4096) throw new Error("Invalid Markdown preferences size");
            const data = JSON.parse(await fs.readFile(file, "utf8"));
            if (data.version !== 1) throw new Error("Unsupported Markdown preferences version");
            return normalize(data);
        } catch (caught) {
            const error = caught as MarkdownIOError;
            if (error.code === "ENOENT") return {...defaults};
            throw error;
        }
    };
    return {
        read: () => queue.then(read),
        update(patch: Partial<MarkdownPreferences>) {
            const copy = {...patch};
            const task = queue.then(async () => {
                const current = await read();
                const preferences = normalize({...current, ...copy});
                await fs.mkdir(directory, {recursive: true, mode: 0o700});
                const staged = await createMarkdownTemporaryFile(file + ".", 0o600);
                const temporary = staged.path;
                let handle: fs.FileHandle | undefined = staged.handle;
                try {
                    await handle.writeFile(JSON.stringify({version: 1, ...preferences}), "utf8");
                    await handle.sync();
                    await handle.close();
                    handle = undefined;
                    await fs.rename(temporary, file);
                    return preferences;
                } finally {
                    if (handle) await handle.close().catch(() => undefined);
                    await fs.unlink(temporary).catch((error: MarkdownIOError) => { if (error.code !== "ENOENT") throw error; });
                }
            });
            queue = task.catch(() => undefined);
            return task;
        },
    };
};

export {createMarkdownPreferences, defaults};
