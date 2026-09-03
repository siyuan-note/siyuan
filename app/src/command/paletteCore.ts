import type {CommandRegistry} from "./registry";
import {searchCommands} from "./search";
import type {ICommandContextSnapshot} from "./types";

export const queryCommandPalette = (registry: CommandRegistry, context: ICommandContextSnapshot, query: string) =>
    searchCommands(registry.list(context), query);

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
        restoreAfterCancel() {
            if (!commandSelected) {
                restoreOnce();
            }
        },
    };
};
