import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {createMarkdownAppearance, defaultMarkdownAppearance} from "./appearance";
import {createMarkdownPreferences} from "./preferences";
import type {MarkdownAppearance, MarkdownFont} from "../../src/markdown/bridge";

const maximumFontBytes = 64 * 1024 * 1024;
const maximumTotalBytes = 128 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const groups = ["global", "editor", "code"] as const;
const validFont = (font: MarkdownFont) => typeof font?.family === "string" && font.family.length > 0 && font.family.length <= 256 &&
    !Array.from(font.family).some(value => {
        const code = value.codePointAt(0)!;
        return code < 32 || code === 127 || code >= 0xd800 && code <= 0xdfff;
    }) && Number.isInteger(font.weight) && font.weight >= 1 && font.weight <= 1000;

export type QuickLookFontPublication = {
    version: number;
    fonts: MarkdownAppearance["fonts"];
    customFonts: Array<{family: string; weight: number; file: string; sha256: string; size: number}>;
    files: Array<{file: string; data: string}>;
};

export const publishQuickLookFonts = (executable: string, publication: QuickLookFontPublication,
    signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Quick Look font publication cancelled")); return; }
    const child = spawn(executable, ["--publish"], {stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
    let failure: Error | undefined;
    const fail = (error: Error) => {failure ??= error; child.kill();};
    const abort = () => fail(new Error("Quick Look font publication cancelled"));
    signal?.addEventListener("abort", abort, {once: true});
    const timeout = setTimeout(() => fail(new Error("Quick Look font publication timed out")), 30000);
    let outputBytes = 0;
    const output = (bytes: Buffer) => {
        outputBytes += bytes.length;
        if (outputBytes > 16384) fail(new Error("Unexpected Quick Look font helper output"));
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.once("error", error => {failure ??= error;});
    child.stdin.once("error", error => fail(error));
    child.once("close", code => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Quick Look font helper exited with ${code}`));
        else resolve();
    });
    child.stdin.end(JSON.stringify(publication));
});

export const prepareQuickLookFontSnapshot = async (appearance: MarkdownAppearance,
    readFont: (token: string) => Promise<{bytes: Buffer; type: string} | undefined>, current: () => boolean = () => true): Promise<QuickLookFontPublication | undefined> => {
    const fonts = Object.fromEntries(groups.map(group => [group, appearance.fonts[group].filter(validFont).slice(0, 32)
        .map(({family, weight}) => ({family, weight}))])) as MarkdownAppearance["fonts"];
    const selected = new Set(groups.flatMap(group => fonts[group].map(font => font.family)));
    const customFonts: Array<{family: string; weight: number; file: string; sha256: string; size: number}> = [];
    const files = new Map<string, Buffer>();
    const resolvedFamilies = new Set<string>();
    let total = 0;
    for (const font of appearance.customFonts.slice(0, 96)) {
        if (!current()) return;
        const id = /^SiYuanCustomFont-([a-f0-9]{64})$/.exec(font.family)?.[1];
        const token = /^\/appearance-font\/([a-f0-9]{48})$/.exec(font.url)?.[1];
        if (!id || !token || !validFont(font) || !selected.has(font.family) || resolvedFamilies.has(font.family)) continue;
        resolvedFamilies.add(font.family);
        let source;
        try { source = await readFont(token); } catch { continue; }
        if (!source || source.bytes.length < 4 || source.bytes.length > maximumFontBytes || digest(source.bytes) !== id) continue;
        const extension = source.type === "font/ttf" ? "ttf" : source.type === "font/otf" ? "otf" : undefined;
        const header = source.bytes.subarray(0, 4).toString("latin1");
        if (!extension || (extension === "ttf" ? !["\0\x01\0\0", "true"].includes(header) : header !== "OTTO")) continue;
        const file = `${id}.${extension}`;
        if (!files.has(file)) {
            if (total + source.bytes.length > maximumTotalBytes) continue;
            total += source.bytes.length;
            files.set(file, source.bytes);
        }
        const weights = new Set(groups.flatMap(group => fonts[group].filter(item => item.family === font.family).map(item => item.weight)));
        for (const weight of weights) customFonts.push({family: font.family, weight, file, sha256: id, size: source.bytes.length});
    }
    const serialized = JSON.stringify({version: 1, fonts, customFonts});
    if (Buffer.byteLength(serialized) > 128 * 1024) throw new Error("Quick Look font snapshot too large");
    if (!current()) return;
    return {version: 1, fonts, customFonts, files: [...files].map(([file, bytes]) => ({file, data: bytes.toString("base64")}))};
};

export const createQuickLookFontSync = (configDirectory: string,
    publish: (publication: QuickLookFontPublication, signal: AbortSignal) => Promise<void>, report: (error: unknown) => void) => {
    const preferences = createMarkdownPreferences(configDirectory);
    const appearance = createMarkdownAppearance(configDirectory);
    let closed = false;
    let requested = 0;
    let completed = 0;
    let task: Promise<void> | undefined;
    let controller: AbortController | undefined;
    const refresh = (): Promise<void> => {
        requested++;
        controller?.abort();
        if (task || closed) return task ?? Promise.resolve();
        task = (async () => {
            while (!closed && completed !== requested) {
                completed = requested;
                const generation = completed;
                const current = () => !closed && generation === requested;
                try {
                    let resolved = defaultMarkdownAppearance();
                    try {
                        const values = await preferences.read();
                        resolved = await appearance.load(values.sources, values.independent);
                    } catch (error) { report(error); }
                    const publication = current() && await prepareQuickLookFontSnapshot(resolved, appearance.readFont, current);
                    if (publication && current()) {
                        controller = new AbortController();
                        await publish(publication, controller.signal);
                    }
                } catch (error) { if (current()) report(error); }
                finally { controller = undefined; }
            }
        })().finally(() => {
            task = undefined;
            if (!closed && completed !== requested) void refresh();
        });
        return task;
    };
    return {refresh, close() {closed = true; requested++; controller?.abort(); appearance.close();}};
};
