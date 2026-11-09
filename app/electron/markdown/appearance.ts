import * as fs from "node:fs/promises";
import {constants} from "node:fs";
import * as path from "node:path";
import {createHash, randomBytes} from "node:crypto";
import type {MarkdownAppearance, MarkdownAppearanceGroup, MarkdownFont, MarkdownPreferences} from "../../src/markdown/bridge";
import {inside} from "./resources";

const maxFontSize = 64 * 1024 * 1024;
const customPrefix = "SiYuanCustomFont-";
const validID = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
type Workspace = {id: string; name: string; root: string};
type FontGrant = {workspace: string; root: string; id: string};
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readJSON = async (file: string, limit: number): Promise<unknown> => {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > limit) throw new Error("Invalid appearance configuration");
        const bytes = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < bytes.length) {
            const read = await handle.read(bytes, length, bytes.length - length, length);
            if (!read.bytesRead) break;
            length += read.bytesRead;
        }
        if (length !== stat.size) throw new Error("Appearance configuration changed");
        return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, length)));
    } finally { await handle.close(); }
};

const fonts = (value: unknown): MarkdownFont[] => {
    if (!Array.isArray(value)) return [];
    const families = new Set<string>();
    return value.slice(0, 32).flatMap(item => {
        const font = object(item);
        if (typeof font.family !== "string" || !font.family || font.family.length > 256 || [...font.family].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || families.has(font.family)) return [];
        families.add(font.family);
        return [{family: font.family, weight: typeof font.weight === "number" && Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000 ? font.weight : 400}];
    });
};
export const defaultMarkdownAppearance = (): MarkdownAppearance => ({
    theme: "system", fontSize: 16, sources: {theme: "", fontSize: "", fonts: ""}, workspaces: [],
    fonts: {global: [], editor: [], code: []}, customFonts: [],
});

export const createMarkdownAppearance = (configDirectory: string) => {
    let grants = new Map<string, FontGrant>();
    let fontSelection = "";
    const fontBytes = new Map<string, number>();
    let customFonts: MarkdownAppearance["customFonts"] = [];
    let closed = false;
    const workspaces = async (): Promise<Workspace[]> => {
        try {
            const values = await readJSON(path.join(path.dirname(configDirectory), "workspace.json"), 1024 * 1024);
            if (!Array.isArray(values)) return [];
            const result: Workspace[] = [];
            for (const value of values.slice(-256)) {
                if (typeof value !== "string" || value.length > 32768 || !path.isAbsolute(value) || value.includes("\0")) continue;
                const selection = path.resolve(value);
                try {
                    const root = await fs.realpath(selection);
                    if (!(await fs.stat(root)).isDirectory()) continue;
                    const id = hash(selection);
                    const previous = result.findIndex(item => item.id === id);
                    if (previous !== -1) result.splice(previous, 1);
                    result.push({id, name: selection, root});
                } catch { /* 离线工作空间不阻止打开 Markdown 文件。 */ }
            }
            return result;
        } catch { return []; }
    };
    const load = async (sources: MarkdownPreferences["sources"] = {}): Promise<MarkdownAppearance> => {
        if (closed) throw new Error("Markdown appearance closed");
        const available = await workspaces();
        const result = defaultMarkdownAppearance();
        result.workspaces = available.map(({id, name}) => ({id, name}));
        const configs = new Map<string, Record<string, unknown>>();
        let fontWorkspace: Workspace | undefined;
        for (const group of ["theme", "fontSize", "fonts"] as MarkdownAppearanceGroup[]) {
            const id = sources[group] || available[available.length - 1]?.id || "";
            result.sources[group] = id;
            const workspace = available.find(item => item.id === id);
            if (!workspace) continue;
            let conf = configs.get(id);
            if (!conf) {
                try {
                    const file = path.join(workspace.root, "conf", "conf.json");
                    if (!inside(workspace.root, await fs.realpath(file))) throw new Error("Invalid workspace configuration");
                    conf = object(await readJSON(file, 4 * 1024 * 1024));
                } catch { conf = {}; }
                configs.set(id, conf);
            }
            const editor = object(conf.editor);
            const appearance = object(conf.appearance);
            if (group === "theme") result.theme = appearance.modeOS === true ? "system" : appearance.mode === 1 ? "dark" : appearance.mode === 0 ? "light" : "system";
            if (group === "fontSize" && typeof editor.fontSize === "number" && Number.isInteger(editor.fontSize) && editor.fontSize >= 9 && editor.fontSize <= 72) result.fontSize = editor.fontSize;
            if (group === "fonts") {
                fontWorkspace = workspace;
                result.fonts = {global: fonts(appearance.globalFontFamilies),
                    editor: fonts(editor.fontFamilies ?? [{family: editor.fontFamily, weight: editor.fontWeight}]), code: fonts(editor.codeFontFamilies)};
            }
        }
        const selection = JSON.stringify([fontWorkspace?.root, result.fonts]);
        if (selection !== fontSelection) {
            const next = new Map<string, FontGrant>();
            const faces: MarkdownAppearance["customFonts"] = [];
            if (fontWorkspace) {
                const seen = new Set<string>();
                for (const font of [...result.fonts.global, ...result.fonts.editor, ...result.fonts.code]) {
                    if (!font.family.startsWith(customPrefix)) continue;
                    const id = font.family.slice(customPrefix.length);
                    if (!validID(id) || seen.has(id)) continue;
                    seen.add(id);
                    const token = randomBytes(24).toString("hex");
                    next.set(token, {workspace: fontWorkspace.root, root: path.join(fontWorkspace.root, "conf", "appearance", "fonts", "custom"), id});
                    faces.push({...font, url: `/appearance-font/${token}`});
                }
            }
            if (closed) throw new Error("Markdown appearance closed");
            grants = next;
            fontBytes.clear();
            customFonts = faces;
            fontSelection = selection;
        }
        result.customFonts = customFonts.map(font => ({...font}));
        return result;
    };
    const readFont = async (token: string): Promise<{bytes: Buffer<ArrayBuffer>; type: string} | undefined> => {
        const grant = grants.get(token);
        if (!grant || closed) return;
        for (const extension of ["ttf", "otf"]) {
            try {
                if (await fs.realpath(grant.root) !== grant.root || !inside(grant.workspace, grant.root)) return;
                const file = path.join(grant.root, `${grant.id}.${extension}`);
                if (await fs.realpath(file) !== file) continue;
                const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
                try {
                    const stat = await handle.stat({bigint: true});
                    if (!stat.isFile() || stat.size < 4n || stat.size > BigInt(maxFontSize)) continue;
                    const otherBytes = [...fontBytes.entries()].reduce((sum, [key, size]) => sum + (key === token ? 0 : size), 0);
                    if (otherBytes + Number(stat.size) > 128 * 1024 * 1024) return;
                    const bytes = Buffer.alloc(Number(stat.size));
                    let offset = 0;
                    while (offset < bytes.length) {
                        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
                        if (!read.bytesRead) break;
                        offset += read.bytesRead;
                    }
                    const after = await handle.stat({bigint: true});
                    const current = await fs.stat(file, {bigint: true});
                    if (offset !== bytes.length || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs ||
                        current.dev !== stat.dev || current.ino !== stat.ino || await fs.realpath(file) !== file ||
                        await fs.realpath(grant.root) !== grant.root || grants.get(token) !== grant || closed) return;
                    const header = bytes.subarray(0, 4).toString("latin1");
                    if ((extension === "ttf" ? !["\0\x01\0\0", "true"].includes(header) : header !== "OTTO") || hash(bytes) !== grant.id) continue;
                    fontBytes.set(token, bytes.length);
                    return {bytes, type: extension === "ttf" ? "font/ttf" : "font/otf"};
                } finally { await handle.close(); }
            } catch { /* 缺失或损坏字体由浏览器按配置顺序回退。 */ }
        }
    };
    let fontRead: Promise<unknown> = Promise.resolve();
    const queuedReadFont = (token: string) => {
        const task = fontRead.then(() => readFont(token));
        fontRead = task.catch(() => undefined);
        return task;
    };
    return {load, readFont: queuedReadFont, async validate(patch: unknown) {
        const values = object(patch);
        if (patch !== values || Object.keys(values).some(key => !["theme", "fontSize", "fonts"].includes(key)) ||
            Object.values(values).some(value => !validID(value))) throw new Error("Invalid appearance source");
        const available = await workspaces();
        if (Object.values(values).some(id => !available.some(item => item.id === id))) throw new Error("Unavailable appearance source");
        return values as Partial<Record<MarkdownAppearanceGroup, string>>;
    }, close() {closed = true; grants.clear(); fontBytes.clear(); customFonts = [];} };
};
