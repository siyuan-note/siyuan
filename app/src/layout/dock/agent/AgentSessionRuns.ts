export type AgentSessionRunStatus = "running" | "unread";

export interface AgentSessionRun<TInteraction = unknown> {
    sessionID: string;
    controller: AbortController;
    turnID: string;
    detached: boolean;
    view?: DocumentFragment;
    pendingInteractions: TInteraction[];
    renderedInteractionKeys: Set<string>;
    interactionViewReady: boolean;
}

export class AgentSessionRuns<TInteraction = unknown> {
    private runs = new Map<string, AgentSessionRun<TInteraction>>();
    private unread = new Set<string>();

    begin(sessionID: string): AgentSessionRun<TInteraction> {
        const current = this.runs.get(sessionID);
        if (current) {
            return current;
        }
        const run: AgentSessionRun<TInteraction> = {
            sessionID,
            controller: new AbortController(),
            turnID: "",
            detached: false,
            pendingInteractions: [],
            renderedInteractionKeys: new Set<string>(),
            interactionViewReady: true,
        };
        this.runs.set(sessionID, run);
        this.unread.delete(sessionID);
        return run;
    }

    get(sessionID: string): AgentSessionRun<TInteraction> | undefined {
        return this.runs.get(sessionID);
    }

    detach(sessionID: string) {
        const run = this.runs.get(sessionID);
        if (run) {
            run.detached = true;
            run.interactionViewReady = false;
        }
    }

    abort(sessionID: string): AgentSessionRun<TInteraction> | undefined {
        const run = this.runs.get(sessionID);
        run?.controller.abort();
        return run;
    }

    complete(run: AgentSessionRun<TInteraction>, unread: boolean): boolean {
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
