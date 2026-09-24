import type {FetchSyncPost} from "../../types/api";

interface IExportJSEmbedOptions {
    disabled: boolean;
    disabledTip: string;
    rootID: string;
    headingMode: number;
}

// 图片预览和独立 PDF 预览窗口共用脚本执行、结果加载和错误处理。
export const renderExportJSEmbeds = async (element: HTMLElement, options: IExportJSEmbedOptions,
                                         fetchSyncPost: FetchSyncPost<IWebSocketData>, depth = 0) => {
    if (depth >= 4) {
        return;
    }
    const embeds = Array.from(element.querySelectorAll<HTMLElement>('[data-type="NodeBlockQueryEmbed"]'))
        .filter(item => {
            const parent = item.parentElement.closest('[data-type="NodeBlockQueryEmbed"]');
            return !parent || parent === element;
        });
    await Promise.all(embeds.map(async item => {
        const content = Lute.UnEscapeHTMLStr(item.getAttribute("data-content") || "");
        if (!content.startsWith("//!js")) {
            return;
        }
        if (options.disabled) {
            item.textContent = options.disabledTip;
            return;
        }
        try {
            const protyle = {
                block: {rootID: item.closest("[data-root-id]")?.getAttribute("data-root-id") || options.rootID},
                notebookId: item.closest("[data-notebook]")?.getAttribute("data-notebook") || "",
                wysiwyg: {element},
                contentElement: element,
                disabled: true,
            };
            const includeIDs = await new Function("fetchSyncPost", "item", "protyle", "top",
                `return (async () => {\n${content}\n})();`)(fetchSyncPost, item, protyle, undefined);
            if (Array.isArray(includeIDs)) {
                const headingMode = item.getAttribute("custom-heading-mode");
                const response = await fetchSyncPost("/api/search/getEmbedBlock", {
                    embedBlockID: item.getAttribute("data-node-id"),
                    includeIDs,
                    headingMode: ["0", "1", "2"].includes(headingMode) ? parseInt(headingMode) : options.headingMode,
                    breadcrumb: false,
                    notebook: item.closest("[data-query-notebook]")?.getAttribute("data-query-notebook") || "",
                });
                if (response.code !== 0) {
                    throw new Error(response.msg);
                }
                item.innerHTML = (response.data.blocks || []).map(entry => entry.block.content).join("");
            }
            item.querySelectorAll(".protyle-icons, .protyle-attr, .protyle-action").forEach(control => control.remove());
            item.querySelectorAll("[contenteditable]").forEach(child => child.setAttribute("contenteditable", "false"));
            await renderExportJSEmbeds(item, options, fetchSyncPost, depth + 1);
        } catch (error) {
            console.error(error);
            item.textContent = String(error);
        }
    }));
};
