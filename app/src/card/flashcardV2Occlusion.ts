export interface IFlashcardV2InlineOcclusion {
    id: string;
    blockID: string;
    displayOrder: number;
    label: string;
}

export const appendFlashcardV2ClozeTargets = (current: {
    targets: IFlashcardV2InlineOcclusion[],
    groupOrder: string[],
    assignments: Record<string, string[]>,
}, candidates: IFlashcardV2InlineOcclusion[], newGroupID: () => string) => {
    const targets = [...current.targets];
    const groupOrder = [...current.groupOrder];
    const assignments = Object.fromEntries(Object.entries(current.assignments)
        .map(([id, groups]) => [id, [...groups]]));
    const included = new Set(targets.map((target) => target.id));
    candidates.forEach((target) => {
        if (included.has(target.id)) {
            return;
        }
        included.add(target.id);
        const groupID = newGroupID();
        targets.push(target);
        groupOrder.push(groupID);
        assignments[target.id] = [groupID];
    });
    return {targets, groupOrder, assignments};
};

export const resolveFlashcardV2InlineOcclusions = (
    marks: Array<{id?: string, blockID: string, label: string}>, newID: () => string) => {
    const owners = new Map<string, string>();
    const replacements = new Map<string, Map<string, string>>();
    const targets = new Map<string, IFlashcardV2InlineOcclusion>();
    const ids = marks.map((mark) => {
        const original = mark.id;
        let id = original || newID();
        const blockReplacements = replacements.get(mark.blockID) || new Map<string, string>();
        if (original && blockReplacements.has(original)) {
            id = blockReplacements.get(original);
        } else if (owners.has(id) && owners.get(id) !== mark.blockID) {
            id = newID();
            blockReplacements.set(original, id);
            replacements.set(mark.blockID, blockReplacements);
        }
        owners.set(id, mark.blockID);
        const target = targets.get(id);
        if (target) {
            target.label += mark.label;
        } else {
            targets.set(id, {id, blockID: mark.blockID, displayOrder: targets.size, label: mark.label});
        }
        return id;
    });
    return {
        ids,
        targets: [...targets.values()].map((target) => ({
            ...target,
            label: target.label.replace(/\s+/g, " ").trim() || target.blockID,
        })),
    };
};
