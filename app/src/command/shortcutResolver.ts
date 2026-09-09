import type {CommandRegistry} from "./registry";
import type {ICommandContextSnapshot} from "./types";

export interface IShortcutCandidate {
    id: string;
    scope: "editor" | "fileTree" | "dock" | "global";
    context: ICommandContextSnapshot;
}

export const resolveShortcut = (registry: CommandRegistry, candidates: IShortcutCandidate[], reportError: (error: unknown) => void) => {
    // 仅考虑当前局部范围和通用范围，同范围按稳定标识排序，不读取用户优先级。
    const ordered = candidates.filter(candidate => candidate.scope === "global" || candidate.scope === candidate.context.focus)
        .sort((first, second) => Number(first.scope === "global") - Number(second.scope === "global") ||
            (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
    for (const candidate of ordered) {
        try {
            const prepared = registry.prepare(candidate.id, candidate.context);
            if (prepared.run) {
                return {candidate, run: prepared.run};
            }
        } catch (error) {
            reportError(error);
        }
    }
    return undefined;
};
