import {compareShortcutBindings, IShortcutOrder} from "./shortcutCatalog";
import type {CommandRegistry} from "./registry";
import type {ICommandContextSnapshot} from "./types";

export interface IShortcutCandidate extends IShortcutOrder {
    context: ICommandContextSnapshot;
}

export const resolveShortcut = (registry: CommandRegistry, candidates: IShortcutCandidate[], reportError: (error: unknown) => void) => {
    for (const candidate of [...candidates].sort(compareShortcutBindings)) {
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
