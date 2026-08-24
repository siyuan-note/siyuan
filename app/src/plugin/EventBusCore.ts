interface IEventBusListener<DetailType> {
    listener: (event: CustomEvent<DetailType>) => any;
    wrapped: EventListener;
    once: boolean;
}

export interface IEventBusSafeEmitResult {
    defaultPrevented: boolean;
    error?: unknown;
    hasAsyncListener: boolean;
}

export class EventBus<DetailType = any> {
    private eventTarget: EventTarget;
    private listeners = new Map<TEventBus, Map<(event: CustomEvent<DetailType>) => any, IEventBusListener<DetailType>>>();
    private safeDispatches = new WeakMap<Event, IEventBusSafeEmitResult>();
    private destroyed = false;

    constructor(name = "", eventTarget?: EventTarget) {
        void name;
        this.eventTarget = eventTarget || new EventTarget();
    }

    private addListener(type: TEventBus, listener: (event: CustomEvent<DetailType>) => any, once: boolean) {
        if (this.destroyed) {
            return;
        }
        let typeListeners = this.listeners.get(type);
        if (!typeListeners) {
            typeListeners = new Map();
            this.listeners.set(type, typeListeners);
        }
        if (typeListeners.has(listener)) {
            return;
        }
        const wrapped: EventListener = (event) => {
            if (once) {
                this.off(type, listener);
            }
            const safeResult = this.safeDispatches.get(event);
            try {
                const result = listener.call(this.eventTarget, event as CustomEvent<DetailType>);
                if (safeResult && result && typeof result.then === "function") {
                    safeResult.hasAsyncListener = true;
                    void Promise.resolve(result).catch(listenerError => console.error(listenerError));
                }
                return result;
            } catch (error) {
                if (!safeResult) {
                    throw error;
                }
                safeResult.error = error;
                event.stopImmediatePropagation();
            }
        };
        typeListeners.set(listener, {listener, wrapped, once});
        this.eventTarget.addEventListener(type, wrapped);
    }

    on(type: TEventBus, listener: (event: CustomEvent<DetailType>) => any) {
        this.addListener(type, listener, false);
    }

    once(type: TEventBus, listener: (event: CustomEvent<DetailType>) => any) {
        this.addListener(type, listener, true);
    }

    off(type: TEventBus, listener: (event: CustomEvent<DetailType>) => any) {
        const typeListeners = this.listeners.get(type);
        const registered = typeListeners?.get(listener);
        if (!registered) {
            return;
        }
        this.eventTarget.removeEventListener(type, registered.wrapped);
        typeListeners.delete(listener);
        if (typeListeners.size === 0) {
            this.listeners.delete(type);
        }
    }

    has(type: TEventBus) {
        return !this.destroyed && !!this.listeners.get(type)?.size;
    }

    emit(type: TEventBus, detail?: DetailType) {
        if (this.destroyed) {
            return true;
        }
        return this.eventTarget.dispatchEvent(new CustomEvent(type, {detail, cancelable: true}));
    }

    emitWithErrors(type: TEventBus, detail?: DetailType): IEventBusSafeEmitResult {
        if (this.destroyed) {
            return {defaultPrevented: false, hasAsyncListener: false};
        }
        const event = new CustomEvent(type, {detail, cancelable: true});
        const result: IEventBusSafeEmitResult = {defaultPrevented: false, hasAsyncListener: false};
        this.safeDispatches.set(event, result);
        try {
            this.eventTarget.dispatchEvent(event);
        } finally {
            this.safeDispatches.delete(event);
        }
        result.defaultPrevented = event.defaultPrevented;
        return result;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.listeners.forEach((typeListeners, type) => {
            typeListeners.forEach(({wrapped}) => {
                this.eventTarget.removeEventListener(type, wrapped);
            });
        });
        this.listeners.clear();
        this.safeDispatches = new WeakMap();
    }
}

type TEventBusOwner = {
    eventBus: EventBus;
};

export const emitToPlugins = (plugins: TEventBusOwner[], type: TEventBus, detail?: any) => {
    Array.from(plugins).forEach((plugin) => {
        if (plugin.eventBus.has(type)) {
            plugin.eventBus.emit(type, detail);
        }
    });
};

export const hasPluginSubscriber = (plugins: TEventBusOwner[], type: TEventBus) => {
    return plugins.some((plugin) => plugin.eventBus.has(type));
};
