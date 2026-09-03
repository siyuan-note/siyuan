import type {App} from "../index";
import {captureCommandContext} from "./context";
import {ensureNativeCommands, getNativeCommandId} from "./nativeCommands";
import {executeLegacyNativeCommand} from "./nativeRuntime";
import {getCommandRegistry} from "./service";
import type {ICommandContextSnapshot, TCommandSource} from "./types";

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
    return getCommandRegistry(app);
};

export const executeCommandById = (
    app: App,
    commandId: string,
    context: ICommandContextSnapshot,
    args?: unknown,
) => ensureCommandSystem(app).execute(commandId, context, args);

export const execByCommand = async (options: IExecByCommandOptions) => {
    const app = options.app || window.siyuan.ws.app;
    const context = options.context || captureCommandContext({
        app,
        source: options.source || "shortcut",
        range: options.previousRange,
        protyle: options.protyle,
        fileLiElements: options.fileLiElements,
    });
    const commandId = getNativeCommandId(options.command);
    if (commandId) {
        return ensureCommandSystem(app).execute(commandId, context);
    }
    await executeLegacyNativeCommand(options.command, context);
    return {status: "executed" as const};
};
