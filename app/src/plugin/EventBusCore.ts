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

const subscribers = new Map<TEventBus, EventBus[]>();
let eventBusOrder = 0;

export class EventBus<DetailType = any> {
    private eventTarget: EventTarget;
    private listeners = new Map<TEventBus, Map<(event: CustomEvent<DetailType>) => any, IEventBusListener<DetailType>>>();
    private safeDispatches = new WeakMap<Event, IEventBusSafeEmitResult>();
    private destroyed = false;
    private readonly order = eventBusOrder++;

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
        if (typeListeners.size === 1) {
            this.addSubscriber(type);
        }
    }

    private addSubscriber(type: TEventBus) {
        let typeSubscribers = subscribers.get(type);
        if (!typeSubscribers) {
            typeSubscribers = [];
            subscribers.set(type, typeSubscribers);
        }
        const index = typeSubscribers.findIndex(eventBus => eventBus.order > this.order);
        if (index === -1) {
            typeSubscribers.push(this);
        } else {
            typeSubscribers.splice(index, 0, this);
        }
    }

    private removeSubscriber(type: TEventBus) {
        const typeSubscribers = subscribers.get(type);
        if (!typeSubscribers) {
            return;
        }
        const index = typeSubscribers.indexOf(this);
        if (index > -1) {
            typeSubscribers.splice(index, 1);
        }
        if (typeSubscribers.length === 0) {
            subscribers.delete(type);
        }
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
            this.removeSubscriber(type);
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
            this.removeSubscriber(type);
        });
        this.listeners.clear();
        this.safeDispatches = new WeakMap();
    }
}

export const forEachPluginSubscriber = (type: TEventBus, callback: (eventBus: EventBus) => void) => {
    const typeSubscribers = subscribers.get(type);
    if (!typeSubscribers) {
        return;
    }
    Array.from(typeSubscribers).forEach(callback);
};

export const emitToPlugins = (type: TEventBus, detail?: any) => {
    forEachPluginSubscriber(type, eventBus => {
        eventBus.emit(type, detail);
    });
};

export const hasPluginSubscriber = (type: TEventBus) => {
    return !!subscribers.get(type)?.length;
};
