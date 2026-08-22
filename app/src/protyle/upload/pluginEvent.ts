export interface IAssetUploadEventContext {
    source: TAssetUploadSource;
    target: TAssetUploadTarget;
    position?: IAssetUploadPosition;
    requiredFileCount?: number;
    allowedInputKinds?: Array<IAssetUploadInput["kind"]>;
}

export interface IAssetUploadTask {
    readonly requestId: string;
    readonly signal: AbortSignal;
    input: IAssetUploadInput;
    startUpload(): void;
    complete(result: Omit<IAssetUploadResult, "requestId" | "input">): boolean;
}

export type TPreparedAssetUpload = {
    state: "ready";
    task: IAssetUploadTask;
} | {
    state: "canceled" | "failed";
    task: IAssetUploadTask;
    error?: string;
};

interface IAssetUploadPlugin {
    name?: string;
    eventBus: {
        emitWithErrors(type: TEventBus, detail: IBeforeUploadAssetsDetail): {
            defaultPrevented: boolean;
            error?: unknown;
            hasAsyncListener: boolean;
        };
    };
}

class AssetUploadCanceledError extends Error {
}

class AssetUploadTimeoutError extends Error {
}

export const ASSET_UPLOAD_PLUGIN_TIMEOUT = 120_000;

let requestSequence = 0;
const waitingTasksByProtyle = new WeakMap<IProtyle, Set<AssetUploadTask>>();
const waitingTasksByPlugin = new WeakMap<IAssetUploadPlugin, Set<AssetUploadTask>>();
const activeTasksByProtyle = new WeakMap<IProtyle, Set<AssetUploadTask>>();

const genRequestId = () => {
    requestSequence++;
    return `${Date.now()}-${requestSequence}`;
};

const cloneInput = (input: IAssetUploadInput): IAssetUploadInput => {
    if (input.kind === "files") {
        return {kind: "files", files: Array.from(input.files)};
    }
    return {kind: "local-files", files: input.files.map(file => ({...file}))};
};

const cloneResult = (result: IAssetUploadResult): IAssetUploadResult => {
    const cloned: IAssetUploadResult = {
        ...result,
        input: cloneInput(result.input),
    };
    if (result.acceptedInput) {
        cloned.acceptedInput = cloneInput(result.acceptedInput);
    }
    if (result.rejected) {
        cloned.rejected = result.rejected.map(item => ({...item, reasons: Array.from(item.reasons)}));
    }
    if (result.succFiles) {
        cloned.succFiles = result.succFiles.map(item => ({...item}));
    }
    if (result.failedFiles) {
        cloned.failedFiles = result.failedFiles.map(item => ({...item}));
    }
    if (result.succMap) {
        cloned.succMap = {...result.succMap};
    }
    if (result.errFiles) {
        cloned.errFiles = Array.from(result.errFiles);
    }
    return cloned;
};

const validateAssetUploadInput = (input: unknown) => {
    if (!input || typeof input !== "object") {
        return "input must be an object";
    }
    const value = input as IAssetUploadInput;
    if (!Array.isArray(value.files)) {
        return "input.files must be an array";
    }
    if (value.kind === "files") {
        const invalidIndex = value.files.findIndex(file => !(file instanceof File) &&
            Object.prototype.toString.call(file) !== "[object File]");
        return invalidIndex === -1 ? "" : `input.files[${invalidIndex}] must be a File`;
    }
    if (value.kind === "local-files") {
        for (let index = 0; index < value.files.length; index++) {
            const file = value.files[index];
            if (!file || typeof file !== "object") {
                return `input.files[${index}] must be an object`;
            }
            if (typeof file.path !== "string" || file.path.length === 0) {
                return `input.files[${index}].path must be a non-empty string`;
            }
            if (file.size !== null && (typeof file.size !== "number" || !Number.isFinite(file.size) || file.size < 0)) {
                return `input.files[${index}].size must be null or a non-negative finite number`;
            }
            if (file.isDir !== undefined && typeof file.isDir !== "boolean") {
                return `input.files[${index}].isDir must be a boolean`;
            }
        }
        return "";
    }
    return "input.kind must be files or local-files";
};

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return typeof error === "string" ? error : "";
};

const getPluginLabel = (plugin: IAssetUploadPlugin, index: number) => plugin.name || `#${index + 1}`;

const validateTargetInput = (input: IAssetUploadInput, context: IAssetUploadEventContext) => {
    if (context.allowedInputKinds && !context.allowedInputKinds.includes(input.kind)) {
        return `this upload only accepts ${context.allowedInputKinds.join(" or ")} input`;
    }
    if (context.requiredFileCount !== undefined && input.files.length !== context.requiredFileCount) {
        if (context.target === "background") {
            return "background uploads require exactly one file";
        }
        return `this upload requires exactly ${context.requiredFileCount} file(s)`;
    }
    return "";
};

class AssetUploadTask implements IAssetUploadTask {
    public readonly requestId: string;
    public readonly signal: AbortSignal;
    public input: IAssetUploadInput;
    private completed = false;
    private readonly abortController = new AbortController();
    private readonly callbacks: Array<(result: IAssetUploadResult) => any> = [];
    private readonly protyle?: IProtyle;
    private waitingPlugins: IAssetUploadPlugin[] = [];
    private uploadStarted = false;

    constructor(input: IAssetUploadInput, requestId: string, protyle?: IProtyle) {
        this.input = cloneInput(input);
        this.requestId = requestId;
        this.protyle = protyle;
        this.signal = this.abortController.signal;
    }

    public addCompleteCallback(callback: (result: IAssetUploadResult) => void) {
        this.callbacks.push(callback);
    }

    public startWaiting(plugins: IAssetUploadPlugin[]) {
        this.stopWaiting();
        this.waitingPlugins = plugins;
        if (this.protyle) {
            let protyleTasks = waitingTasksByProtyle.get(this.protyle);
            if (!protyleTasks) {
                protyleTasks = new Set();
                waitingTasksByProtyle.set(this.protyle, protyleTasks);
            }
            protyleTasks.add(this);
        }
        plugins.forEach(plugin => {
            let pluginTasks = waitingTasksByPlugin.get(plugin);
            if (!pluginTasks) {
                pluginTasks = new Set();
                waitingTasksByPlugin.set(plugin, pluginTasks);
            }
            pluginTasks.add(this);
        });
    }

    public stopWaiting() {
        if (this.protyle) {
            waitingTasksByProtyle.get(this.protyle)?.delete(this);
        }
        this.waitingPlugins.forEach(plugin => waitingTasksByPlugin.get(plugin)?.delete(this));
        this.waitingPlugins = [];
    }

    public startUpload() {
        if (this.uploadStarted || !this.protyle) {
            return;
        }
        this.uploadStarted = true;
        let tasks = activeTasksByProtyle.get(this.protyle);
        if (!tasks) {
            tasks = new Set();
            activeTasksByProtyle.set(this.protyle, tasks);
        }
        tasks.add(this);
    }

    public abort(reason: Error) {
        if (!this.signal.aborted) {
            this.abortController.abort(reason);
        }
    }

    public complete(result: Omit<IAssetUploadResult, "requestId" | "input">) {
        if (this.completed) {
            return false;
        }
        this.completed = true;
        this.stopWaiting();
        if (this.protyle) {
            activeTasksByProtyle.get(this.protyle)?.delete(this);
        }
        const detail: IAssetUploadResult = {
            ...result,
            requestId: this.requestId,
            input: cloneInput(this.input),
        };
        if (result.acceptedInput) {
            detail.acceptedInput = cloneInput(result.acceptedInput);
        }
        if (result.rejected) {
            detail.rejected = result.rejected.map(item => ({...item, reasons: Array.from(item.reasons)}));
        }
        this.callbacks.forEach(callback => {
            try {
                const callbackResult = callback(cloneResult(detail));
                if (callbackResult && typeof callbackResult.then === "function") {
                    void Promise.resolve(callbackResult).catch(error => console.error(error));
                }
            } catch (error) {
                console.error(error);
            }
        });
        return true;
    }
}

const cancelWaitingTasks = (tasks: Set<AssetUploadTask> | undefined, reason: string) => {
    Array.from(tasks || []).forEach(task => task.abort(new AssetUploadCanceledError(reason)));
};

export const cancelAssetUploads = (protyle: IProtyle) => {
    cancelWaitingTasks(waitingTasksByProtyle.get(protyle), "The editor was destroyed");
    cancelWaitingTasks(activeTasksByProtyle.get(protyle), "The editor was destroyed");
};

export const cancelAssetUploadsByPlugin = (plugin: IAssetUploadPlugin) => {
    cancelWaitingTasks(waitingTasksByPlugin.get(plugin), `Plugin ${plugin.name || ""} was unloaded`.trim());
};

const waitForDecision = (response: PromiseLike<IAssetUploadDecision>, task: AssetUploadTask,
                         pluginLabel: string, timeout: number) => {
    return new Promise<IAssetUploadDecision>((resolve, reject) => {
        let settled = false;
        const finish = (callback: (value: any) => void, value: any) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            task.signal.removeEventListener("abort", onAbort);
            callback(value);
        };
        const onAbort = () => finish(reject, task.signal.reason instanceof Error ? task.signal.reason :
            new AssetUploadCanceledError("The upload was canceled"));
        const timeoutId = setTimeout(() => {
            task.abort(new AssetUploadTimeoutError(`Plugin ${pluginLabel} asset processing timed out`));
        }, timeout);
        task.signal.addEventListener("abort", onAbort, {once: true});
        if (task.signal.aborted) {
            onAbort();
            return;
        }
        Promise.resolve(response).then(value => finish(resolve, value), error => finish(reject, error));
    });
};

export const prepareAssetUpload = (options: {
    plugins: IAssetUploadPlugin[];
    protyle?: IProtyle;
    input: IAssetUploadInput;
    context: IAssetUploadEventContext;
    requestId?: string;
    timeout?: number;
}): TPreparedAssetUpload | Promise<TPreparedAssetUpload> => {
    const task = new AssetUploadTask(options.input, options.requestId || genRequestId(), options.protyle);
    const plugins = Array.from(options.plugins);
    const timeout = options.timeout ?? ASSET_UPLOAD_PLUGIN_TIMEOUT;
    const context = {
        ...options.context,
        requiredFileCount: options.context.requiredFileCount ??
            (options.context.target === "background" ? 1 : undefined),
    };
    const fail = (error: unknown): TPreparedAssetUpload => {
        const errorMessage = getErrorMessage(error);
        task.abort(error instanceof Error ? error : new Error(errorMessage));
        task.complete({status: "failed", error: errorMessage});
        return {state: "failed", task, error: errorMessage};
    };
    const cancel = (reason = "The upload was canceled"): TPreparedAssetUpload => {
        task.abort(new AssetUploadCanceledError(reason));
        task.complete({status: "canceled"});
        return {state: "canceled", task};
    };
    const initialValidationError = validateTargetInput(task.input, context);
    if (initialValidationError) {
        return fail(initialValidationError);
    }
    task.startWaiting(plugins);
    const processPlugin = (index: number): TPreparedAssetUpload | Promise<TPreparedAssetUpload> => {
        if (task.signal.aborted) {
            const reason = task.signal.reason instanceof Error ? task.signal.reason.message : "The upload was canceled";
            return cancel(reason);
        }
        if (index >= plugins.length) {
            task.stopWaiting();
            return {state: "ready", task};
        }
        const plugin = plugins[index];
        const pluginLabel = getPluginLabel(plugin, index);
        let response: PromiseLike<IAssetUploadDecision> | undefined;
        let responseClaimed = false;
        let responseError = "";
        let acceptingRegistrations = true;
        let emitResult: ReturnType<IAssetUploadPlugin["eventBus"]["emitWithErrors"]>;
        const discardResponse = () => {
            if (response) {
                void Promise.resolve(response).catch(error => console.error(error));
            }
        };
        try {
            emitResult = plugin.eventBus.emitWithErrors("before-upload-assets", {
                requestId: task.requestId,
                protyle: options.protyle,
                source: context.source,
                target: context.target,
                position: context.position ? {...context.position} : undefined,
                requiredFileCount: context.requiredFileCount,
                allowedInputKinds: context.allowedInputKinds ? Array.from(context.allowedInputKinds) : undefined,
                input: cloneInput(task.input),
                signal: task.signal,
                respondWith(value) {
                    if (!acceptingRegistrations) {
                        console.error(new Error(`Plugin ${pluginLabel} must call respondWith synchronously`));
                        return;
                    }
                    if (responseClaimed) {
                        responseError = `Plugin ${pluginLabel} called respondWith more than once`;
                        return;
                    }
                    responseClaimed = true;
                    response = Promise.resolve(value);
                },
                onComplete(callback) {
                    if (!acceptingRegistrations) {
                        console.error(new Error(`Plugin ${pluginLabel} must register onComplete synchronously`));
                        return;
                    }
                    task.addCompleteCallback(callback);
                },
            });
        } catch (error) {
            acceptingRegistrations = false;
            discardResponse();
            return fail(error);
        }
        acceptingRegistrations = false;
        if (emitResult.error) {
            discardResponse();
            return fail(new Error(`Plugin ${pluginLabel} failed during before-upload-assets: ${getErrorMessage(emitResult.error)}`));
        }
        if (emitResult.defaultPrevented) {
            discardResponse();
            return fail(new Error(`Plugin ${pluginLabel} must use respondWith to replace or cancel an asset upload`));
        }
        if (responseError) {
            discardResponse();
            return fail(responseError);
        }
        if (emitResult.hasAsyncListener && !responseClaimed) {
            return fail(new Error(`Plugin ${pluginLabel} must call respondWith synchronously before awaiting`));
        }
        if (!response) {
            return processPlugin(index + 1);
        }
        return waitForDecision(response, task, pluginLabel, timeout).then(decision => {
            if (decision?.action === "cancel") {
                return cancel();
            }
            if (decision?.action !== "replace") {
                throw new Error(`Plugin ${pluginLabel} returned an invalid action`);
            }
            const validationError = validateAssetUploadInput(decision.input);
            if (validationError) {
                throw new Error(`Plugin ${pluginLabel} returned invalid input: ${validationError}`);
            }
            const targetValidationError = validateTargetInput(decision.input, context);
            if (targetValidationError) {
                throw new Error(`Plugin ${pluginLabel} returned invalid input: ${targetValidationError}`);
            }
            task.input = cloneInput(decision.input);
            return processPlugin(index + 1);
        }).catch(error => error instanceof AssetUploadCanceledError ? cancel(error.message) : fail(error));
    };
    return processPlugin(0);
};
