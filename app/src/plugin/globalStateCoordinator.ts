export interface IGlobalPluginStatePayload {
    globalPetalEnabled: boolean;
    globalPetalDisabled: boolean;
    globalPetalRevision: number;
    globalPetalChanged: boolean;
}

export interface IGlobalPluginStateSnapshot {
    petalDisabled: boolean;
    pending: boolean;
    revision: number;
}

interface IGlobalPluginStateCoordinatorOptions<TPayload extends IGlobalPluginStatePayload> {
    initialPetalDisabled: boolean;
    applyLifecycle: (payload: TPayload) => Promise<void>;
    applyConfig?: (petalDisabled: boolean) => void;
}

export class GlobalPluginStateCoordinator<TPayload extends IGlobalPluginStatePayload> {
    private readonly applyLifecycle: (payload: TPayload) => Promise<void>;
    private readonly applyConfig: (petalDisabled: boolean) => void;
    private readonly listeners = new Set<(state: IGlobalPluginStateSnapshot) => void>();
    private revision = -1;
    private lifecycleRevision = -1;
    private petalDisabled: boolean;
    private pending = false;
    private transition?: {revision: number, promise: Promise<void>};

    constructor(options: IGlobalPluginStateCoordinatorOptions<TPayload>) {
        this.petalDisabled = options.initialPetalDisabled;
        this.applyLifecycle = options.applyLifecycle;
        this.applyConfig = options.applyConfig || (() => undefined);
    }

    public subscribe(listener: (state: IGlobalPluginStateSnapshot) => void) {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => this.listeners.delete(listener);
    }

    public syncConfig(petalDisabled: boolean) {
        this.petalDisabled = petalDisabled;
        this.applyConfig(petalDisabled);
        this.notify();
    }

    public apply(payload: TPayload) {
        const revision = payload.globalPetalRevision;
        if (!Number.isSafeInteger(revision) || revision < 0) {
            return Promise.reject(new Error(`invalid global plugin state revision: ${revision}`));
        }
        if (revision < this.revision) {
            return Promise.resolve();
        }

        this.petalDisabled = payload.globalPetalDisabled;
        this.applyConfig(this.petalDisabled);
        const isNewRevision = revision > this.revision;
        if (isNewRevision) {
            this.revision = revision;
        }
        if (!payload.globalPetalChanged) {
            this.notify();
            return this.transition?.revision === revision ? this.transition.promise : Promise.resolve();
        }
        if (this.lifecycleRevision >= revision) {
            this.notify();
            return this.transition?.revision === revision ? this.transition.promise : Promise.resolve();
        }

        this.lifecycleRevision = revision;
        this.pending = true;
        this.notify();
        const promise = Promise.resolve().then(() => this.applyLifecycle(payload)).finally(() => {
            if (this.revision !== revision) {
                return;
            }
            this.pending = false;
            this.transition = undefined;
            this.notify();
        });
        this.transition = {revision, promise};
        return promise;
    }

    private snapshot(): IGlobalPluginStateSnapshot {
        return {
            petalDisabled: this.petalDisabled,
            pending: this.pending,
            revision: this.revision,
        };
    }

    private notify() {
        const state = this.snapshot();
        this.listeners.forEach((listener) => listener(state));
    }
}
