export type Reaction<T> = {
    name: string;
    changed: (old: T, next: T) => boolean;
    apply: (old: T, next: T) => void | Promise<void>;
};

// 在替换配置前确定变更动作，动作始终接收同一组前后快照。
export const createSectionRuntime = <T>(options: {
    namespace: string;
    get: () => T;
    set: (data: T) => void | Promise<void>;
    reactions: Reaction<T>[];
}) => ({
    apply: (next: T) => {
        const old = options.get();
        const reactions = options.reactions.filter(reaction => reaction.changed(old, next));
        const applied = options.set(next);
        const applyReactions = () => Promise.all(reactions.map(reaction => reaction.apply(old, next))).then(() => {});
        return applied ? applied.then(applyReactions) : applyReactions();
    },
});
