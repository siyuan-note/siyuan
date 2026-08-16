interface IDisconnectable {
    disconnect: () => void;
}

export class PdfLoadState {
    private destroyed = false;
    private timeout?: number;
    private observer?: IDisconnectable;

    public get isDestroyed() {
        return this.destroyed;
    }

    public setTimeout(timeout: number) {
        this.clearTimeout();
        if (this.destroyed) {
            window.clearTimeout(timeout);
            return false;
        }
        this.timeout = timeout;
        return true;
    }

    public consumeTimeout() {
        this.timeout = undefined;
        return !this.destroyed;
    }

    public setObserver(observer: IDisconnectable) {
        this.clearObserver();
        if (this.destroyed) {
            observer.disconnect();
            return false;
        }
        this.observer = observer;
        return true;
    }

    public consumeObserver() {
        this.clearObserver();
        return !this.destroyed;
    }

    public clearPending() {
        this.clearTimeout();
        this.clearObserver();
    }

    public destroy() {
        if (this.destroyed) {
            return false;
        }
        this.destroyed = true;
        this.clearPending();
        return true;
    }

    private clearTimeout() {
        if (typeof this.timeout === "undefined") {
            return;
        }
        window.clearTimeout(this.timeout);
        this.timeout = undefined;
    }

    private clearObserver() {
        this.observer?.disconnect();
        this.observer = undefined;
    }
}
