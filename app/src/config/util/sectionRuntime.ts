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
        const applyReactions = () => {
            let pending: Promise<void>;
            for (const reaction of reactions) {
                const run = () => reaction.apply(old, next);
                if (pending) {
                    pending = pending.then(run);
                } else {
                    const applied = run();
                    if (applied) pending = applied;
                }
            }
            return pending || Promise.resolve();
        };
        return applied ? applied.then(applyReactions) : applyReactions();
    },
});
