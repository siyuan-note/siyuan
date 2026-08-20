export type AgentSessionRunStatus = "running" | "unread";

export interface AgentSessionRun<TInteraction = unknown, TEvent = unknown, TViewState = unknown> {
    sessionID: string;
    controller: AbortController;
    turnID: string;
    detached: boolean;
    replaying: boolean;
    processingPromise?: Promise<void>;
    replayPromise?: Promise<void>;
    pendingEvents: TEvent[];
    viewState?: TViewState;
    pendingInteractions: TInteraction[];
    renderedInteractionKeys: Set<string>;
    interactionViewReady: boolean;
}

export class AgentSessionRuns<TInteraction = unknown, TEvent = unknown, TViewState = unknown> {
    private runs = new Map<string, AgentSessionRun<TInteraction, TEvent, TViewState>>();
    private unread = new Set<string>();

    begin(sessionID: string): AgentSessionRun<TInteraction, TEvent, TViewState> {
        const current = this.runs.get(sessionID);
        if (current) {
            return current;
        }
        const run: AgentSessionRun<TInteraction, TEvent, TViewState> = {
            sessionID,
            controller: new AbortController(),
            turnID: "",
            detached: false,
            replaying: false,
            pendingEvents: [],
            pendingInteractions: [],
            renderedInteractionKeys: new Set<string>(),
            interactionViewReady: true,
        };
        this.runs.set(sessionID, run);
        this.unread.delete(sessionID);
        return run;
    }

    get(sessionID: string): AgentSessionRun<TInteraction, TEvent, TViewState> | undefined {
        return this.runs.get(sessionID);
    }

    enqueue(run: AgentSessionRun<TInteraction, TEvent, TViewState>, event: TEvent): boolean {
        if (this.runs.get(run.sessionID) !== run) {
            return false;
        }
        run.pendingEvents.push(event);
        return true;
    }

    drain(run: AgentSessionRun<TInteraction, TEvent, TViewState>): TEvent[] {
        if (this.runs.get(run.sessionID) !== run || run.pendingEvents.length === 0) {
            return [];
        }
        return run.pendingEvents.splice(0);
    }

    detach(sessionID: string) {
        const run = this.runs.get(sessionID);
        if (run) {
            run.detached = true;
            run.interactionViewReady = false;
        }
    }

    abort(sessionID: string): AgentSessionRun<TInteraction, TEvent, TViewState> | undefined {
        const run = this.runs.get(sessionID);
        run?.controller.abort();
        return run;
    }

    complete(run: AgentSessionRun<TInteraction, TEvent, TViewState>, unread: boolean): boolean {
        if (this.runs.get(run.sessionID) !== run) {
            return false;
        }
        this.runs.delete(run.sessionID);
        if (unread) {
            this.unread.add(run.sessionID);
        }
        return true;
    }

    markRead(sessionID: string) {
        this.unread.delete(sessionID);
    }

    resolveStatus(sessionID: string): AgentSessionRunStatus | undefined {
        if (this.runs.has(sessionID)) {
            return "running";
        }
        if (this.unread.has(sessionID)) {
            return "unread";
        }
        return undefined;
    }

    hasRunning(): boolean {
        return this.runs.size > 0;
    }
}
