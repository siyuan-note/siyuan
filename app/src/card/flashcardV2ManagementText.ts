import {fetchSyncPost} from "../util/fetch";
import {flashcardV2ReferenceHTML, readFlashcardV2RenderModel, selectFlashcardV2References} from "./flashcardV2Render";

const textContent = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const text = template.content.textContent.replace(/\s+/g, " ").trim();
    const characters = Array.from(text);
    return characters.length > 160 ? characters.slice(0, 160).join("") + "..." : text;
};

export const loadFlashcardManagementText = async (cards: Array<{card: {id: string}, sourceBlockID?: string}>,
    signal: AbortSignal, update: (cardID: string, text: {parent?: string, front?: string, back?: string}) => void) => {
    const request = (path: string, data: object) => fetchSyncPost(path, data, undefined, false, signal);
    const breadcrumbs = new Map<string, ReturnType<typeof request>>();
    let next = 0;
    const worker = async () => {
        while (next < cards.length && !signal.aborted) {
            const card = cards[next++];
            try {
                if (card.sourceBlockID && !breadcrumbs.has(card.sourceBlockID)) {
                    breadcrumbs.set(card.sourceBlockID, request("/api/block/getBlockBreadcrumb", {id: card.sourceBlockID}));
                }
                const [response, breadcrumb] = await Promise.all([
                    request("/api/flashcard/getRenderModel", {cardID: card.card.id}), breadcrumbs.get(card.sourceBlockID),
                ]);
                if (signal.aborted || response.code !== 0) { continue; }
                const parent = breadcrumb?.code === 0 && Array.isArray(breadcrumb.data) ?
                    breadcrumb.data.at(-2)?.name : undefined;
                const model = readFlashcardV2RenderModel(response.data);
                const references = model.references;
                let front = selectFlashcardV2References(references, model.template.frontSpec);
                if (front.length === 0) { front = references; }
                const frontIDs = new Set(front.map(ref => ref.entityID));
                let back = selectFlashcardV2References(references, model.template.backSpec);
                if (back.length === 0) { back = references; }
                back = back.filter(ref => !frontIDs.has(ref.entityID));
                front = front.slice(0, 2);
                back = back.slice(0, 2);
                const ids = [...new Set([...front, ...back].filter(ref => ref.entityType === "block").map(ref => ref.entityID))];
                const blocks = ids.length ? await request("/api/block/getBlockDOMs", {ids}) : undefined;
                if (signal.aborted) { return; }
                const doms = blocks?.code === 0 ? blocks.data : {};
                const summarize = (parts: typeof front) => textContent(parts.map(ref => flashcardV2ReferenceHTML(ref, doms)).join(" "));
                update(card.card.id, {parent: typeof parent === "string" ? textContent(parent) : undefined,
                    front: summarize(front), back: summarize(back)});
            } catch (error) {
                if (!signal.aborted) { console.error("Flashcard row preview failed", error); }
            }
        }
    };
    await Promise.all(Array.from({length: Math.min(cards.length, 4)}, worker));
};
