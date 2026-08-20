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

    constructor(name = "", eventTarget?: EventTarget) {
        this.eventTarget = eventTarget || document.appendChild(document.createComment(name));
    }

    private addListener(type: TEventBus, listener: (event: CustomEvent<DetailType>) => any, once: boolean) {
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

    emit(type: TEventBus, detail?: DetailType) {
        return this.eventTarget.dispatchEvent(new CustomEvent(type, {detail, cancelable: true}));
    }

    emitWithErrors(type: TEventBus, detail?: DetailType): IEventBusSafeEmitResult {
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
}
