import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {ExpectedMarkdownFile} from "../markdown/disk";

const hasUnsafeCharacters = (value: string) => value.includes("\\") || Array.from(value).some(character => character.charCodeAt(0) < 32);

// Only a kernel-resolved asset may cross this bridge, never a renderer-supplied absolute path.
export const normalizeMarkdownAsset = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.length > 4096) return;
    const link = value.trim().split("#")[0];
    if (!link.startsWith("assets/") || hasUnsafeCharacters(link)) return;
    let pathname: string;
    try { pathname = decodeURIComponent(link.split("?")[0]); } catch { return; }
    if (!/^assets\/.+\.(md|markdown)$/i.test(pathname) || hasUnsafeCharacters(pathname) ||
        pathname.split("/").some(part => part === ".." || part === "." || !part)) return;
    return link;
};

export const verifyMarkdownAssetPath = async (workspace: string, value: unknown): Promise<ExpectedMarkdownFile> => {
    if (typeof value !== "string" || !path.isAbsolute(value) || !/\.(md|markdown)$/i.test(value)) {
        throw new Error("Invalid Markdown asset");
    }
    const root = await fs.realpath(path.join(workspace, "data"));
    const file = await fs.realpath(value);
    const stat = await fs.stat(file, {bigint: true});
    if (await fs.realpath(file) !== file) throw new Error("Markdown asset changed during authorization");
    const relative = path.relative(root, file);
    const parts = relative.split(path.sep);
    const assetsIndex = parts.indexOf("assets");
    const validAncestors = assetsIndex >= 0 && parts.slice(0, assetsIndex).every(part => /^\d{14}-[a-z0-9]{7}$/.test(part));
    // Decrypted external-open copies live outside data and must never be edited as the original.
    if (path.isAbsolute(relative) || parts.includes("..") ||
        !validAncestors || assetsIndex === parts.length - 1 || !/\.(md|markdown)$/i.test(file) ||
        !stat.isFile()) throw new Error("Markdown asset is outside its workspace assets");
    return {path: file, identity: `${stat.dev}:${stat.ino}`};
};
