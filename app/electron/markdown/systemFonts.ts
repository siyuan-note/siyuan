import {execFile} from "node:child_process";
import type {MarkdownSystemFont} from "../../src/markdown/bridge";
import {parseSystemFontsJSON} from "../../src/util/systemFontCore";

type ExecuteFonts = (file: string, args: string[], signal: AbortSignal) => Promise<string>;
const executeFonts: ExecuteFonts = (file, args, signal) => new Promise((resolve, reject) => {
    execFile(file, args, {encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, killSignal: "SIGKILL", signal},
        (error, stdout) => error ? reject(error) : resolve(stdout));
});

// 只运行应用随附的只读字体命令，不启动工作空间或常驻内核服务。
export const createMarkdownSystemFonts = (executable: string, execute: ExecuteFonts = executeFonts) => {
    const controller = new AbortController();
    const pending = new Map<string, Promise<MarkdownSystemFont[]>>();
    const load = (language = "en"): Promise<MarkdownSystemFont[]> => {
        if (controller.signal.aborted) return Promise.reject(new Error("Font enumeration disposed"));
        if (!/^[a-z]{2}(?:[-_][A-Za-z]{2,4})?$/.test(language)) return Promise.reject(new Error("Invalid font language"));
        const existing = pending.get(language);
        if (existing) return existing;
        const request = execute(executable, ["system", "fonts", "--lang", language], controller.signal).then(json => {
            if (Buffer.byteLength(json, "utf8") > 4 * 1024 * 1024) throw new Error("Font list too large");
            const fonts = parseSystemFontsJSON(json);
            if (fonts.length > 20000) throw new Error("Font list too large");
            return fonts.filter(font => font.family.length <= 256 && font.displayName.length <= 1024 && !font.family.startsWith("SiYuanCustomFont-"));
        });
        pending.set(language, request);
        request.finally(() => {if (pending.get(language) === request) pending.delete(language);}).catch(() => undefined);
        return request;
    };
    return Object.assign(load, {dispose() {controller.abort(); pending.clear();}});
};
