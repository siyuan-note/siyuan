import * as fs from "node:fs/promises";
import * as path from "node:path";
import {createMarkdownTemporaryFile} from "./temporaryFile";
import type {MarkdownIndependentAppearance, MarkdownPreferences} from "../../src/markdown/bridge";
import type {MarkdownIOError} from "./types";

const defaults: Readonly<MarkdownPreferences> = Object.freeze({mode: "ir"});
export const normalizeIndependentAppearance = (value: unknown): MarkdownIndependentAppearance => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid independent appearance");
    const data = value as MarkdownIndependentAppearance;
    if (Object.keys(data).some(key => !["theme", "fontSize", "fonts"].includes(key)) ||
        data.theme !== undefined && !["system", "light", "dark"].includes(data.theme) ||
        data.fontSize !== undefined && (!Number.isInteger(data.fontSize) || data.fontSize < 9 || data.fontSize > 72)) throw new Error("Invalid independent appearance");
    if (data.fonts !== undefined) {
        if (!data.fonts || typeof data.fonts !== "object" || Array.isArray(data.fonts) || Object.keys(data.fonts).some(key => !["global", "editor", "code"].includes(key))) throw new Error("Invalid independent fonts");
        for (const group of ["global", "editor", "code"] as const) {
            const fonts = data.fonts[group];
            if (!Array.isArray(fonts) || fonts.length > 32 || fonts.some(font => !font || typeof font.family !== "string" || !font.family || font.family.length > 256 ||
                font.family.startsWith("SiYuanCustomFont-") || [...font.family].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char.codePointAt(0)! >= 0xd800 && char.codePointAt(0)! <= 0xdfff) ||
                !Number.isInteger(font.weight) || font.weight < 1 || font.weight > 1000 || Object.keys(font).some(key => !["family", "weight"].includes(key)))) throw new Error("Invalid independent fonts");
        }
    }
    return JSON.parse(JSON.stringify(data));
};
const normalize = (value: unknown): MarkdownPreferences => {
    const data = value as Record<string, unknown> | undefined;
    if (!data || typeof data.mode !== "string" || !["ir", "wysiwyg", "sv"].includes(data.mode)) {
        throw new Error("Invalid Markdown preferences");
    }
    const sources = data.sources as MarkdownPreferences["sources"];
    if (sources !== undefined && (!sources || typeof sources !== "object" || Array.isArray(sources) ||
        Object.keys(sources).some(key => !["theme", "fontSize", "fonts"].includes(key)) ||
        Object.values(sources).some(value => typeof value !== "string" || value !== "independent" && !/^[a-f0-9]{64}$/.test(value)))) {
        throw new Error("Invalid Markdown appearance sources");
    }
    return {mode: data.mode as MarkdownPreferences["mode"], ...(sources === undefined ? {} : {sources: {...sources}}),
        ...(data.independent === undefined ? {} : {independent: normalizeIndependentAppearance(data.independent)})};
};

const createMarkdownPreferences = (directory: string) => {
    const file = path.join(directory, "preferences.json");
    let queue: Promise<unknown> = Promise.resolve();
    const read = async (): Promise<MarkdownPreferences> => {
        try {
            const stat = await fs.stat(file);
            if (stat.size > 131072) throw new Error("Invalid Markdown preferences size");
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
            const copy = {...patch, ...(patch.independent === undefined ? {} : {independent: normalizeIndependentAppearance(patch.independent)}), ...(patch.sources === undefined ? {} : {sources: {...patch.sources}})};
            const task = queue.then(async () => {
                const current = await read();
                const preferences = normalize({...current, ...copy,
                    ...(copy.independent === undefined ? {} : {independent: {...current.independent, ...copy.independent}}),
                    ...(copy.sources === undefined ? {} : {sources: {...current.sources, ...copy.sources}})});
                const serialized = JSON.stringify({version: 1, ...preferences});
                if (Buffer.byteLength(serialized, "utf8") > 131072) throw new Error("Invalid Markdown preferences size");
                await fs.mkdir(directory, {recursive: true, mode: 0o700});
                const staged = await createMarkdownTemporaryFile(file + ".", 0o600);
                const temporary = staged.path;
                let handle: fs.FileHandle | undefined = staged.handle;
                try {
                    await handle.writeFile(serialized, "utf8");
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
