import {getHostCapabilities} from "../util/hostCapabilities";
import {getAssetExtension, isEncryptedBox} from "../util/pathName";
import {showMessage} from "../dialog/message";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export const canOpenMarkdownAsset = (source: string): boolean => {
    const link = source.trim();
    if (!getHostCapabilities().localFileSystem || !link.startsWith("assets/") ||
        ![".md", ".markdown"].includes(getAssetExtension(link).toLowerCase())) return false;
    try {
        // External-open copies of encrypted assets do not write back to their notebook.
        return !isEncryptedBox(new URL(link, window.location.origin).searchParams.get("box"));
    } catch { return false; }
};

export const openMarkdownAsset = async (source: string): Promise<void> => {
    /// #if !BROWSER
    if (!canOpenMarkdownAsset(source)) return;
    try {
        if (await ipcRenderer.invoke("siyuan-open-markdown", source.trim())) return;
    } catch { /* The IPC failure is reported without exposing a host path. */ }
    showMessage(window.siyuan.languages.markdownLoadError);
    /// #endif
};
