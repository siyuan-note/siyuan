interface IGroupCard {
    card: {id: string, sourceID: string, variantKey: string};
    sourceType: string;
}

export const flashcardV2GroupNumber = (config: unknown, variantKey: string): number | undefined => {
    if (!variantKey.startsWith("group:") || !config || typeof config !== "object") { return; }
    const groups = (config as {groups?: unknown}).groups;
    if (!Array.isArray(groups) || groups.some(group => !group || typeof group.id !== "string" ||
        !Number.isInteger(group.displayOrder) || group.displayOrder < 0) ||
        new Set(groups.map(group => group.id)).size !== groups.length) { return; }
    const sorted = [...groups].sort((left, right) => left.displayOrder - right.displayOrder ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const index = sorted.findIndex(group => group.id === variantKey.slice("group:".length));
    return index < 0 ? undefined : index + 1;
};

export const loadFlashcardV2GroupNumbers = async (cards: IGroupCard[],
    load: (sourceID: string) => Promise<unknown>) => {
    const grouped = cards.filter(card => ["cloze", "image-occlusion"].includes(card.sourceType));
    const configs = new Map<string, unknown>();
    await Promise.all([...new Set(grouped.map(card => card.card.sourceID))].map(async sourceID => {
        try {
            configs.set(sourceID, await load(sourceID));
        } catch {
            configs.set(sourceID, undefined);
        }
    }));
    const numbers = new Map<string, number>();
    grouped.forEach(card => {
        const number = flashcardV2GroupNumber(configs.get(card.card.sourceID), card.card.variantKey);
        if (number !== undefined) { numbers.set(card.card.id, number); }
    });
    return numbers;
};
