export type TViewStateValue = string | number | boolean | null | TViewStateValue[] | {
    [key: string]: TViewStateValue,
};

export type TViewStateData = Record<string, TViewStateValue>;

export interface IViewStateIdentity {
    scope: string,
    surface: string,
    hostID: string,
}

export interface IViewStateTransport {
    get(key: string): Promise<TViewStateData>,
    patch(key: string, values: TViewStateData, removeKeys: string[]): Promise<void>,
}

export interface IViewStateServiceOptions {
    flushDelay?: number,
    transport?: IViewStateTransport,
}

const DEFAULT_FLUSH_DELAY = 400;
const MAX_PATCH_ENTRIES = 1000;
const MAX_PATCH_BYTES = 256 * 1024;

const getPatchByteLength = (values: TViewStateData, removeKeys: string[]) => {
    const json = JSON.stringify({values, removeKeys});
    if (typeof json !== "string") {
        throw new Error("Invalid view state patch");
    }
    const goCompatibleJSON = json.replace(/[<>&\u2028\u2029]/g, character => {
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
    return new TextEncoder().encode(goCompatibleJSON).byteLength;
};

const isViewStateData = (value: unknown): value is TViewStateData => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const checkResponse = (response: IWebSocketData, action: string) => {
    if (!response || response.code !== 0) {
        throw new Error(response?.msg || `Failed to ${action} view state`);
    }
};

const defaultTransport: IViewStateTransport = {
    async get(key) {
        const {fetchSyncPost} = await import("./fetch");
        const response = await fetchSyncPost("/api/storage/getViewState", {key});
        checkResponse(response, "get");
        return isViewStateData(response.data) ? response.data : {};
    },
    async patch(key, values, removeKeys) {
        const {fetchSyncPost} = await import("./fetch");
        const response = await fetchSyncPost("/api/storage/patchViewState", {key, values, removeKeys});
        checkResponse(response, "patch");
    },
};

const validateIdentityPart = (name: string, value: string) => {
    if (!value) {
        throw new Error(`View state ${name} must not be empty`);
    }
};

const validateField = (field: string) => {
    if (!field || field.length > 2048) {
        throw new Error("Invalid view state field");
    }
};

export const getViewStateKey = (identity: IViewStateIdentity) => {
    validateIdentityPart("scope", identity.scope);
    validateIdentityPart("surface", identity.surface);
    validateIdentityPart("hostID", identity.hostID);
    const key = [identity.scope, identity.surface, identity.hostID].map(encodeURIComponent).join(":");
    if (key.length > 1024) {
        throw new Error("View state key is too long");
    }
    return key;
};

export class ViewStateService {
    public readonly key: string;
    public readonly ready: Promise<void>;
    private readonly data: TViewStateData = {};
    private readonly pendingValues = new Map<string, TViewStateValue>();
    private readonly pendingRemovals = new Set<string>();
    private readonly flushDelay: number;
    private readonly transport: IViewStateTransport;
    private flushTimer?: ReturnType<typeof setTimeout>;
    private flushChain: Promise<void> = Promise.resolve();
    private destroyed = false;
    private destroyPromise?: Promise<void>;

    constructor(identity: IViewStateIdentity, options: IViewStateServiceOptions = {}) {
        this.key = getViewStateKey(identity);
        this.flushDelay = options.flushDelay ?? DEFAULT_FLUSH_DELAY;
        this.transport = options.transport || defaultTransport;
        this.ready = this.load().catch(error => console.error(error));
    }

    public has(field: string) {
        validateField(field);
        return Object.prototype.hasOwnProperty.call(this.data, field);
    }

    public get<T = TViewStateValue>(field: string) {
        validateField(field);
        return this.data[field] as T | undefined;
    }

    public snapshot() {
        return {...this.data};
    }

    public set<T>(field: string, value: T) {
        this.ensureActive();
        validateField(field);
        const stateValue = value as TViewStateValue;
        this.validateValue(field, stateValue);
        this.data[field] = stateValue;
        this.pendingRemovals.delete(field);
        this.pendingValues.set(field, stateValue);
        this.scheduleFlush();
    }

    public patch(values: TViewStateData, removeKeys: string[] = []) {
        this.ensureActive();
        Object.entries(values).forEach(([field, value]) => {
            validateField(field);
            this.validateValue(field, value);
        });
        removeKeys.forEach(validateField);
        Object.entries(values).forEach(([field, value]) => {
            this.data[field] = value;
            this.pendingRemovals.delete(field);
            this.pendingValues.set(field, value);
        });
        removeKeys.forEach((field) => {
            delete this.data[field];
            this.pendingValues.delete(field);
            this.pendingRemovals.add(field);
        });
        if (Object.keys(values).length > 0 || removeKeys.length > 0) {
            this.scheduleFlush();
        }
    }

    public remove(field: string) {
        this.patch({}, [field]);
    }

    public flush() {
        this.clearFlushTimer();
        const result = this.flushChain.catch(() => undefined).then(async () => {
            await this.ready;
            while (this.pendingValues.size > 0 || this.pendingRemovals.size > 0) {
                await this.flushPending();
            }
        });
        this.flushChain = result.catch(() => undefined);
        return result;
    }

    public destroy() {
        if (this.destroyPromise) {
            return this.destroyPromise;
        }
        this.destroyed = true;
        this.destroyPromise = this.flush();
        return this.destroyPromise;
    }

    private async load() {
        const remoteData = await this.transport.get(this.key);
        Object.entries(remoteData).forEach(([field, value]) => {
            if (!this.pendingValues.has(field) && !this.pendingRemovals.has(field)) {
                this.data[field] = value;
            }
        });
    }

    private async flushPending() {
        const {values, removeKeys} = this.takePendingBatch();
        try {
            await this.transport.patch(this.key, values, removeKeys);
        } catch (error) {
            Object.entries(values).forEach(([field, value]) => {
                if (!this.pendingValues.has(field) && !this.pendingRemovals.has(field)) {
                    this.pendingValues.set(field, value);
                }
            });
            removeKeys.forEach((field) => {
                if (!this.pendingValues.has(field) && !this.pendingRemovals.has(field)) {
                    this.pendingRemovals.add(field);
                }
            });
            throw error;
        }
    }

    private takePendingBatch() {
        const values: TViewStateData = {};
        const removeKeys: string[] = [];
        let count = 0;
        for (const [field, value] of this.pendingValues) {
            const nextValues = {...values, [field]: value};
            if (count > 0 && (count >= MAX_PATCH_ENTRIES ||
                getPatchByteLength(nextValues, removeKeys) > MAX_PATCH_BYTES)) {
                break;
            }
            values[field] = value;
            this.pendingValues.delete(field);
            count++;
        }
        if (count < MAX_PATCH_ENTRIES && this.pendingValues.size === 0) {
            for (const field of this.pendingRemovals) {
                const nextRemoveKeys = [...removeKeys, field];
                if (count > 0 && (count >= MAX_PATCH_ENTRIES ||
                    getPatchByteLength(values, nextRemoveKeys) > MAX_PATCH_BYTES)) {
                    break;
                }
                removeKeys.push(field);
                this.pendingRemovals.delete(field);
                count++;
            }
        }
        if (count === 0) {
            throw new Error("View state patch cannot be split within the storage limits");
        }
        return {values, removeKeys};
    }

    private validateValue(field: string, value: TViewStateValue) {
        if (getPatchByteLength({[field]: value}, []) > MAX_PATCH_BYTES) {
            throw new Error("View state value is too large");
        }
    }

    private scheduleFlush() {
        this.clearFlushTimer();
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flush().catch((error) => console.error(error));
        }, this.flushDelay);
    }

    private clearFlushTimer() {
        if (this.flushTimer !== undefined) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    private ensureActive() {
        if (this.destroyed) {
            throw new Error("View state service has been destroyed");
        }
    }
}
