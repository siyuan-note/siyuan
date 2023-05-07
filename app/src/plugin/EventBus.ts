export class EventBus<DetailType = any> {
    private eventTarget: EventTarget;

    constructor(name = "") {
        this.eventTarget = document.appendChild(document.createComment(name));
    }

    on(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.addEventListener(type, listener);
    }

    once(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.addEventListener(type, listener, {once: true});
    }

    off(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.removeEventListener(type, listener);
    }

    emit(type: TEventBus, detail?: DetailType) {
        return this.eventTarget.dispatchEvent(new CustomEvent(type, {detail}));
    }
}
