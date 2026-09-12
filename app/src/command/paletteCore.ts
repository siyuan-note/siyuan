import type {CommandRegistry} from "./registry";
import {searchCommands} from "./search";
import type {ICommandContextSnapshot} from "./types";

export const COMMAND_PALETTE_HISTORY_KEY = "local-command-palette-history";

export const normalizePaletteHistory = (value: unknown): string[] => Array.isArray(value) ?
    [...new Set(value.filter((id): id is string => typeof id === "string" && !!id.trim()))].slice(0, 64) : [];

export const recordPaletteCommand = (history: unknown, commandId: string) =>
    normalizePaletteHistory([commandId, ...normalizePaletteHistory(history).filter(id => id !== commandId)]);

export const queryCommandPalette = (
    registry: CommandRegistry, context: ICommandContextSnapshot, query: string, history?: unknown,
) => {
    const recent = new Map(normalizePaletteHistory(history).map((id, index) => [id, index]));
    const commands = registry.list(context).sort((first, second) =>
        (recent.get(first.id) ?? Infinity) - (recent.get(second.id) ?? Infinity));
    return searchCommands(commands, query);
};

export const createPaletteFocusLifecycle = (restore: () => void) => {
    let restored = false;
    const restoreOnce = () => {
        if (!restored) {
            restored = true;
            restore();
        }
    };
    let commandSelected = false;
    return {
        prepareCommand(beforeRestore?: () => void) {
            beforeRestore?.();
            commandSelected = true;
            restoreOnce();
        },
        restoreAfterCancel(shouldRestore = true) {
            if (!commandSelected && shouldRestore) {
                restoreOnce();
            }
            return !commandSelected;
        },
    };
};
