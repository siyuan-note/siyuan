export const flashcardV2ConflictSummary = (payload: unknown, language: Record<string, string>,
    versions: unknown[] = [payload]) => {
    const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" &&
        !Array.isArray(value) ? value as Record<string, unknown> : {};
    const value = object(payload);
    const compared = versions.map(object);
    const fields = [
        ["name", "name"],
        ["newLimit", "flashcardNewCardLimit"],
        ["reviewLimit", "flashcardReviewCardLimit"],
        ["requestRetention", "flashcardTargetRetention"],
    ];
    return fields.flatMap(([key, label]) => {
        const field = value[key];
        if (!language[label] || !compared.some(version =>
            typeof version[key] === "string" || typeof version[key] === "number")) { return []; }
        const present = Object.prototype.hasOwnProperty.call(value, key);
        const different = compared.some(version => Object.prototype.hasOwnProperty.call(version, key) !== present ||
            JSON.stringify(version[key]) !== JSON.stringify(field));
        return [{label: language[label], different, value: !present ? language.flashcardConflictMissingValue :
            typeof field === "string" || typeof field === "object" ? JSON.stringify(field) : String(field)}];
    });
};

export class FlashcardV2ConflictProgress {
    private readonly completed = new Set<number>();

    public has(index: number) {
        return this.completed.has(index);
    }

    public async resolve(count: number, save: (index: number) => Promise<boolean>) {
        for (let index = 0; index < count; index++) {
            if (this.completed.has(index)) { continue; }
            if (!await save(index)) { return false; }
            this.completed.add(index);
        }
        return true;
    }
}
