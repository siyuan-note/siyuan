export interface IAssetUploadEventContext {
    source: TAssetUploadSource;
    target: TAssetUploadTarget;
    position?: IAssetUploadPosition;
}

export interface IAssetUploadTask {
    readonly requestId: string;
    input: IAssetUploadInput;
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
    eventBus: {
        emit(type: TEventBus, detail: IBeforeUploadAssetsDetail): boolean;
    };
}

let requestSequence = 0;

const genRequestId = () => {
    requestSequence++;
    return `${Date.now()}-${requestSequence}`;
};

const cloneInput = (input: IAssetUploadInput): IAssetUploadInput => {
    if (input.kind === "files") {
        return {kind: "files", files: Array.from(input.files)};
    }
    return {kind: "local-files", files: Array.from(input.files)};
};

const isAssetUploadInput = (input: unknown): input is IAssetUploadInput => {
    if (!input || typeof input !== "object") {
        return false;
    }
    const value = input as IAssetUploadInput;
    return (value.kind === "files" || value.kind === "local-files") && Array.isArray(value.files);
};

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return typeof error === "string" ? error : "";
};

class AssetUploadTask implements IAssetUploadTask {
    public readonly requestId: string;
    public input: IAssetUploadInput;
    private completed = false;
    private readonly callbacks: Array<(result: IAssetUploadResult) => void> = [];

    constructor(input: IAssetUploadInput, requestId: string) {
        this.input = cloneInput(input);
        this.requestId = requestId;
    }

    public addCompleteCallback(callback: (result: IAssetUploadResult) => void) {
        this.callbacks.push(callback);
    }

    public complete(result: Omit<IAssetUploadResult, "requestId" | "input">) {
        if (this.completed) {
            return false;
        }
        this.completed = true;
        const detail: IAssetUploadResult = {
            ...result,
            requestId: this.requestId,
            input: cloneInput(this.input),
        };
        this.callbacks.forEach(callback => {
            try {
                callback(detail);
            } catch (error) {
                console.error(error);
            }
        });
        return true;
    }
}

export const prepareAssetUpload = (options: {
    plugins: IAssetUploadPlugin[];
    protyle: IProtyle;
    input: IAssetUploadInput;
    context: IAssetUploadEventContext;
    requestId?: string;
}): TPreparedAssetUpload | Promise<TPreparedAssetUpload> => {
    const task = new AssetUploadTask(options.input, options.requestId || genRequestId());
    const fail = (error: unknown): TPreparedAssetUpload => {
        const errorMessage = getErrorMessage(error);
        task.complete({status: "failed", error: errorMessage});
        return {state: "failed", task, error: errorMessage};
    };
    const cancel = (): TPreparedAssetUpload => {
        task.complete({status: "canceled"});
        return {state: "canceled", task};
    };
    const processPlugin = (index: number): TPreparedAssetUpload | Promise<TPreparedAssetUpload> => {
        if (index >= options.plugins.length) {
            return {state: "ready", task};
        }
        let response: PromiseLike<IAssetUploadDecision> | undefined;
        let responseError = "";
        const emitResult = options.plugins[index].eventBus.emit("before-upload-assets", {
            requestId: task.requestId,
            protyle: options.protyle,
            source: options.context.source,
            target: options.context.target,
            position: options.context.position,
            input: cloneInput(task.input),
            respondWith(value) {
                if (response) {
                    responseError = "before-upload-assets respondWith can only be called once";
                    return;
                }
                response = Promise.resolve(value);
            },
            onComplete(callback) {
                task.addCompleteCallback(callback);
            },
        });
        if (!emitResult) {
            return cancel();
        }
        if (responseError) {
            return fail(responseError);
        }
        if (!response) {
            return processPlugin(index + 1);
        }
        return Promise.resolve(response).then(decision => {
            if (decision?.action === "cancel") {
                return cancel();
            }
            if (decision?.action !== "replace" || !isAssetUploadInput(decision.input)) {
                throw new Error("Invalid before-upload-assets response");
            }
            task.input = cloneInput(decision.input);
            return processPlugin(index + 1);
        }).catch(fail);
    };
    return processPlugin(0);
};
