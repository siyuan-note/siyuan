export interface PDFNavigationEntry {
    dest?: string | unknown[];
    hash?: string;
    key?: string;
    landingHash?: string;
    page?: number;
    rotation?: number;
}

interface PDFNavigationLocation {
    pageNumber: number;
    pdfOpenParams: string;
    rotation: number;
}

interface PDFNavigationEventBus {
    _on(eventName: string, listener: (event: {location: PDFNavigationLocation}) => void,
        options?: {signal?: AbortSignal}): void;
    dispatch(eventName: string, data: unknown): void;
}

interface PDFNavigationLinkService {
    goToDestination(destination: string | unknown[]): Promise<void> | void;
    page: number;
    pagesCount: number;
    rotation: number;
    setHash(hash: string): void;
}

interface PDFStoredPosition {
    page?: number | string;
    rotation?: number | string;
    scrollLeft?: number | string;
    scrollTop?: number | string;
    zoom?: number | string;
}

const entriesEqual = (first: PDFNavigationEntry, second: PDFNavigationEntry) => {
    return first.hash === second.hash && (first.rotation ?? 0) === (second.rotation ?? 0);
};

export class PDFNavigationStack {
    private entries: PDFNavigationEntry[] = [];
    private index = -1;
    private readonly limit: number;

    constructor(limit: number) {
        this.limit = Math.max(1, limit);
    }

    public get canGoBack() {
        return this.index > 0;
    }

    public get canGoForward() {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }

    public get current() {
        return this.index >= 0 ? this.entries[this.index] : undefined;
    }

    public get length() {
        return this.entries.length;
    }

    public reset() {
        this.entries = [];
        this.index = -1;
    }

    public seed(entry: PDFNavigationEntry) {
        this.entries = [entry];
        this.index = 0;
    }

    public replace(entry: PDFNavigationEntry) {
        if (this.index < 0) {
            this.seed(entry);
            return;
        }
        this.entries[this.index] = entry;
    }

    public push(entry: PDFNavigationEntry, equals = entriesEqual) {
        if (this.current && equals(this.current, entry)) {
            this.replace(entry);
            return false;
        }
        this.entries.splice(this.index + 1);
        this.entries.push(entry);
        if (this.entries.length > this.limit) {
            this.entries.shift();
        }
        this.index = this.entries.length - 1;
        return true;
    }

    public back() {
        if (!this.canGoBack) {
            return;
        }
        this.index--;
        return this.current;
    }

    public forward() {
        if (!this.canGoForward) {
            return;
        }
        this.index++;
        return this.current;
    }
}

export class PDFNavigationHistory {
    private readonly eventBus: PDFNavigationEventBus;
    private readonly linkService: PDFNavigationLinkService;
    private readonly stack: PDFNavigationStack;
    private eventAbortController: AbortController;
    private initialized = false;
    private appendInitialPosition = false;
    private awaitingLanding = false;
    private navigationStartHash: string;
    private navigationTarget: PDFNavigationEntry;
    private navigationTimeout: ReturnType<typeof setTimeout>;
    private readonly navigationTimeoutMs: number;
    private position: PDFNavigationEntry;
    private restoring = false;

    constructor(options: {
        eventBus: PDFNavigationEventBus,
        linkService: PDFNavigationLinkService,
        limit: number,
        navigationTimeoutMs?: number,
    }) {
        this.eventBus = options.eventBus;
        this.linkService = options.linkService;
        this.stack = new PDFNavigationStack(options.limit);
        this.navigationTimeoutMs = options.navigationTimeoutMs ?? 1000;
    }

    public get initialBookmark(): string | null {
        return null;
    }

    public get initialRotation(): number | null {
        return null;
    }

    public get popStateInProgress() {
        return this.restoring || this.awaitingLanding;
    }

    public initialize() {
        this.reset();
        this.initialized = true;
        this.eventAbortController = new AbortController();
        this.eventBus._on("updateviewarea", this.updateViewarea.bind(this), {
            signal: this.eventAbortController.signal,
        });
        this.dispatchState();
    }

    public reset() {
        this.initialized = false;
        this.eventAbortController?.abort();
        this.eventAbortController = undefined;
        this.clearNavigationTimeout();
        this.stack.reset();
        this.position = undefined;
        this.appendInitialPosition = false;
        this.awaitingLanding = false;
        this.navigationStartHash = undefined;
        this.navigationTarget = undefined;
        this.restoring = false;
        this.dispatchState();
    }

    public seedPreviousPosition(stored: PDFStoredPosition) {
        if (!this.initialized) {
            return;
        }
        const page = Number.parseInt(stored.page?.toString(), 10);
        if (!Number.isInteger(page) || page < 1 || page > this.linkService.pagesCount) {
            return;
        }
        const zoom = stored.zoom || "auto";
        const scrollLeft = stored.scrollLeft ?? 0;
        const scrollTop = stored.scrollTop ?? 0;
        const rotation = Number.parseInt(stored.rotation?.toString(), 10);
        this.stack.seed({
            hash: `page=${page}&zoom=${zoom},${scrollLeft},${scrollTop}`,
            landingHash: `page=${page}&zoom=${zoom},${scrollLeft},${scrollTop}`,
            page,
            rotation: Number.isInteger(rotation) ? rotation : undefined,
        });
        this.appendInitialPosition = true;
        this.dispatchState();
    }

    public pushCurrentPosition() {
        if (!this.initialized || this.popStateInProgress || !this.position) {
            return;
        }
        const current = this.stack.current;
        this.stack.replace({
            ...current,
            ...this.position,
            key: current?.key,
            landingHash: current?.landingHash,
        });
    }

    public push(options: {namedDest?: string, explicitDest: unknown[], pageNumber: number}) {
        if (!this.initialized || this.popStateInProgress) {
            return;
        }
        const hash = options.namedDest || JSON.stringify(options.explicitDest);
        this.pushTarget({
            dest: options.explicitDest,
            hash,
            key: `dest:${hash}`,
            page: options.pageNumber,
            rotation: this.linkService.rotation,
        });
    }

    public pushPage(pageNumber: number) {
        if (!this.initialized || this.popStateInProgress || !Number.isInteger(pageNumber) ||
            pageNumber < 1 || pageNumber > this.linkService.pagesCount) {
            return;
        }
        const hash = `page=${pageNumber}`;
        this.pushTarget({
            hash,
            key: hash,
            page: pageNumber,
            rotation: this.linkService.rotation,
        });
    }

    public async back() {
        if (!this.initialized || this.popStateInProgress || !this.stack.canGoBack) {
            return;
        }
        this.snapshotCurrentPosition();
        const entry = this.stack.back();
        if (entry) {
            await this.restore(entry);
        }
    }

    public async forward() {
        if (!this.initialized || this.popStateInProgress || !this.stack.canGoForward) {
            return;
        }
        this.snapshotCurrentPosition();
        const entry = this.stack.forward();
        if (entry) {
            await this.restore(entry);
        }
    }

    private pushTarget(entry: PDFNavigationEntry) {
        const current = this.stack.current;
        if (current?.key === entry.key && current.landingHash === this.position?.hash) {
            return;
        }
        this.appendInitialPosition = false;
        this.stack.push(entry, () => false);
        this.awaitingLanding = true;
        this.navigationStartHash = this.position?.hash;
        this.navigationTarget = entry;
        this.startNavigationTimeout();
        this.dispatchState();
    }

    private snapshotCurrentPosition() {
        if (!this.position) {
            return;
        }
        const current = this.stack.current;
        this.stack.replace({
            ...current,
            ...this.position,
            key: current?.key,
            landingHash: current?.landingHash,
        });
    }

    private async restore(entry: PDFNavigationEntry) {
        this.restoring = true;
        this.navigationStartHash = this.position?.hash;
        this.navigationTarget = entry;
        this.dispatchState();
        try {
            if (Number.isInteger(entry.rotation)) {
                this.linkService.rotation = entry.rotation;
            }
            if (entry.dest) {
                await this.linkService.goToDestination(entry.dest);
            } else if (entry.hash) {
                this.linkService.setHash(entry.hash);
            } else if (entry.page) {
                this.linkService.page = entry.page;
            }
        } finally {
            if (this.restoring) {
                this.startNavigationTimeout();
            }
        }
    }

    private updateViewarea(event: {location: PDFNavigationLocation}) {
        const hash = event.location?.pdfOpenParams?.substring(1);
        if (!hash) {
            return;
        }
        const position = {
            hash,
            page: this.linkService.page || event.location.pageNumber,
            rotation: event.location.rotation,
        };
        if (!this.initialized) {
            this.position = position;
            return;
        }
        if ((this.awaitingLanding || this.restoring) && !this.isNavigationTarget(position)) {
            return;
        }
        this.position = position;

        const current = this.stack.current;
        if (!current) {
            this.stack.seed({...this.position, landingHash: hash});
        } else if (this.appendInitialPosition) {
            this.stack.push({...this.position, landingHash: hash});
            this.appendInitialPosition = false;
        } else if (this.awaitingLanding || this.restoring) {
            this.stack.replace({
                ...current,
                ...this.position,
                key: current.key,
                landingHash: this.awaitingLanding ? hash : current.landingHash,
            });
            this.awaitingLanding = false;
            this.restoring = false;
            this.navigationStartHash = undefined;
            this.navigationTarget = undefined;
            this.clearNavigationTimeout();
        }
        this.dispatchState();
    }

    private isNavigationTarget(position: PDFNavigationEntry) {
        if (!this.navigationTarget) {
            return false;
        }
        if (Number.isInteger(this.navigationTarget.rotation) &&
            position.rotation !== this.navigationTarget.rotation) {
            return false;
        }
        if (this.navigationTarget.hash?.includes("&zoom=")) {
            return position.hash === this.navigationTarget.hash;
        }
        if (this.navigationTarget.page && position.page !== this.navigationTarget.page) {
            return false;
        }
        return position.hash !== this.navigationStartHash;
    }

    private startNavigationTimeout() {
        this.clearNavigationTimeout();
        this.navigationTimeout = setTimeout(() => {
            this.position = undefined;
            this.awaitingLanding = false;
            this.restoring = false;
            this.navigationStartHash = undefined;
            this.navigationTarget = undefined;
            this.navigationTimeout = undefined;
            this.dispatchState();
        }, this.navigationTimeoutMs);
    }

    private clearNavigationTimeout() {
        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
            this.navigationTimeout = undefined;
        }
    }

    private dispatchState() {
        this.eventBus.dispatch("pdfhistorystatechanged", {
            canGoBack: !this.popStateInProgress && this.stack.canGoBack,
            canGoForward: !this.popStateInProgress && this.stack.canGoForward,
            source: this,
        });
    }
}
