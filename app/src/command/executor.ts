import type {App} from "../index";
import {captureCommandContext} from "./context";
import {ensureNativeCommands, getNativeCommandId} from "./nativeCommands";
import {executeLegacyNativeCommand} from "./nativeRuntime";
import {getCommandRegistry} from "./service";
import {ensureContextCommands} from "./contextCommands";
import type {ICommandContextSnapshot, TCommandSource} from "./types";
import {createKeyboardSearchTrace} from "../util/keyboardDiagnostic";

interface IExecByCommandOptions {
    command: string;
    app?: App;
    previousRange?: Range;
    protyle?: IProtyle;
    fileLiElements?: Element[];
    context?: ICommandContextSnapshot;
    source?: TCommandSource;
}

export const ensureCommandSystem = (app: App) => {
    ensureNativeCommands(app, executeLegacyNativeCommand);
    ensureContextCommands(app);
    return getCommandRegistry(app);
};

export const executeCommandById = (
    app: App,
    commandId: string,
    context: ICommandContextSnapshot,
    args?: unknown,
) => ensureCommandSystem(app).execute(commandId, context, args);

export const execByCommand = async (options: IExecByCommandOptions) => {
    const trace = createKeyboardSearchTrace(options.command);
    trace("command-enter");
    const app = options.app || window.siyuan.ws.app;
    const context = options.context || captureCommandContext({
        app,
        source: options.source || "shortcut",
        range: options.previousRange,
        protyle: options.protyle,
        fileLiElements: options.fileLiElements,
    });
    const commandId = getNativeCommandId(options.command);
    try {
        if (commandId) {
            const result = await ensureCommandSystem(app).execute(commandId, context);
            trace("command-result", result.status);
            return result;
        }
        await executeLegacyNativeCommand(options.command, context);
        trace("command-result", "executed");
        return {status: "executed" as const};
    } catch (error) {
        trace("command-error", "exception");
        throw error;
    }
};
