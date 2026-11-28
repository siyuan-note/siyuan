import {fetchSyncPost} from "../util/fetch";

export const getFlashcardV2BlockScope = async (id: string, type: string) => {
    const dom = type === "NodeHeading" ? await fetchSyncPost("/api/block/getHeadingChildrenDOM", {id}) :
        await fetchSyncPost("/api/block/getBlockDOM", {id});
    if (dom.code !== 0) {
        return;
    }
    const source = typeof dom.data === "string" ? dom.data : dom.data?.dom;
    if (typeof source !== "string") {
        return;
    }
    const template = document.createElement("template");
    template.innerHTML = source;
    const ids = new Set([id]);
    template.content.querySelectorAll<HTMLElement>('[data-node-id][data-type^="Node"]').forEach(block => {
        const embed = block.closest('[data-type="NodeBlockQueryEmbed"]');
        if (!embed || embed === block) {
            ids.add(block.dataset.nodeId);
        }
    });
    return [...ids];
};
