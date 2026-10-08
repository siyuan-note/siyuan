import type {ISSEResult} from "./agentSSE";
import {AgentSessionRun, AgentSessionRuns} from "./AgentSessionRuns";

export type PendingAgentInteraction = Extract<ISSEResult, {type: "confirm" | "question"}>;
export type ManagedAgentRun<TState> = AgentSessionRun<PendingAgentInteraction, ISSEResult, TState>;

export interface AgentRunView<TState> {
    currentSessionID: () => string;
    beforeBegin: () => void;
    activate: (run: ManagedAgentRun<TState>) => void;
    detached: (run: ManagedAgentRun<TState>) => void;
    completed: (run: ManagedAgentRun<TState>) => void;
    discarded: (run: ManagedAgentRun<TState>, current: boolean) => void;
    changed: () => void;
    finishedDetached: (run: ManagedAgentRun<TState>, attached: boolean) => void;
    snapshot: () => TState;
    prepareDetach: () => void;
    captureView: (state: TState) => void;
    restore: (state: TState, consumed: () => void) => boolean;
    notifyInteraction: () => void;
    renderInteraction: (event: PendingAgentInteraction) => Promise<void>;
    handleEvent: (event: ISSEResult) => Promise<void>;
    handleBrowserCall: (event: Extract<ISSEResult, {type: "browser_capability_call"}>) => Promise<void>;
    startReplay: (run: ManagedAgentRun<TState>) => void;
    prepareReplayContent: () => void;
    idleReplay: () => void;
    recoverUnavailable: (run: ManagedAgentRun<TState>) => void;
}

// 控制器管理每次运行的状态与异步时序，界面通过快照和渲染回调提供当前会话的视图。
export class AgentRunController<TState> {
    constructor(private runs: AgentSessionRuns<PendingAgentInteraction, ISSEResult, TState>,
                private view: AgentRunView<TState>) {
    }

    private isCurrent(run: ManagedAgentRun<TState>) {
        return this.view.currentSessionID() === run.sessionID;
    }

    begin(): ManagedAgentRun<TState> {
        this.view.beforeBegin();
        const run = this.runs.begin(this.view.currentSessionID());
        this.view.activate(run);
        this.runs.markRead(this.view.currentSessionID());
        this.view.changed();
        return run;
    }

    detach(sessionID: string): boolean {
        const run = this.runs.get(sessionID);
        if (!run) {
            return false;
        }
        this.runs.detach(sessionID);
        this.view.detached(run);
        this.view.changed();
        return true;
    }

    snapshot(run: ManagedAgentRun<TState>) {
        run.viewState = this.view.snapshot();
    }

    prepareForDetach(run: ManagedAgentRun<TState>) {
        this.view.prepareDetach();
        this.snapshot(run);
    }

    captureView(run: ManagedAgentRun<TState>) {
        if (run.viewState) {
            this.view.captureView(run.viewState);
        }
    }

    restore(run: ManagedAgentRun<TState>): boolean {
        if (!run.viewState) {
            return false;
        }
        return this.view.restore(run.viewState, () => { run.viewState = undefined; });
    }

    private interactionKey(event: PendingAgentInteraction): string {
        return event.type === "confirm" ? `confirm:${event.confirmID}` : `question:${event.questionID}`;
    }

    queueInteraction(run: ManagedAgentRun<TState>, event: PendingAgentInteraction, notify = true) {
        const key = this.interactionKey(event);
        if (!run.pendingInteractions.some(item => this.interactionKey(item) === key)) {
            run.pendingInteractions.push(event);
            if (notify) {
                this.view.notifyInteraction();
            }
        }
    }

    removeInteraction(sessionID: string, type: PendingAgentInteraction["type"], id: string) {
        const run = this.runs.get(sessionID);
        if (!run) {
            return;
        }
        const key = `${type}:${id}`;
        run.pendingInteractions = run.pendingInteractions.filter(item => this.interactionKey(item) !== key);
        run.renderedInteractionKeys.delete(key);
    }

    private async renderInteraction(run: ManagedAgentRun<TState>, event: PendingAgentInteraction) {
        if (!this.isCurrent(run) || !run.interactionViewReady) {
            return;
        }
        const key = this.interactionKey(event);
        if (run.renderedInteractionKeys.has(key)) {
            return;
        }
        run.renderedInteractionKeys.add(key);
        await this.view.renderInteraction(event);
    }

    private async renderPendingInteractions(run: ManagedAgentRun<TState>) {
        for (const event of run.pendingInteractions) {
            await this.renderInteraction(run, event);
        }
    }

    async processView(run: ManagedAgentRun<TState>, task: () => Promise<void>) {
        const processingPromise = task();
        run.processingPromise = processingPromise;
        try {
            await processingPromise;
        } finally {
            if (run.processingPromise === processingPromise) {
                run.processingPromise = undefined;
            }
        }
    }

    async waitForView(run: ManagedAgentRun<TState>) {
        const pending = [run.processingPromise, run.replayPromise].filter((promise): promise is Promise<void> => !!promise);
        await Promise.all(pending.map(promise => promise.catch(() => undefined)));
    }

    enqueue(run: ManagedAgentRun<TState>, event: ISSEResult) {
        if (this.runs.get(run.sessionID) !== run) {
            return;
        }
        const lastIndex = run.pendingEvents.length - 1;
        const lastEvent = run.pendingEvents[lastIndex];
        if (event.type === "content" && lastEvent?.type === "content") {
            run.pendingEvents[lastIndex] = {...lastEvent, token: lastEvent.token + event.token};
            return;
        }
        if (event.type === "reasoning" && lastEvent?.type === "reasoning") {
            run.pendingEvents[lastIndex] = {...lastEvent, token: lastEvent.token + event.token};
            return;
        }
        this.runs.enqueue(run, event);
    }

    async handleEvent(run: ManagedAgentRun<TState>, event: ISSEResult) {
        if (event.type === "turn") {
            run.turnID = event.turnID;
        }
        if (!run.detached && !run.replaying && this.isCurrent(run)) {
            if (event.type === "confirm" || event.type === "question") {
                this.queueInteraction(run, event, false);
                run.renderedInteractionKeys.add(this.interactionKey(event));
            }
            await this.processView(run, () => this.view.handleEvent(event));
            return;
        }
        if (event.type === "browser_capability_call") {
            await this.view.handleBrowserCall(event);
            return;
        }
        if (event.type === "confirm" || event.type === "question") {
            this.queueInteraction(run, event, !this.isCurrent(run));
            return;
        }
        this.enqueue(run, event);
    }

    async finish(run: ManagedAgentRun<TState>) {
        const replayPromise = run.replayPromise;
        if (replayPromise) {
            await replayPromise;
        }
        const detached = run.detached;
        const attached = this.isCurrent(run) && run.interactionViewReady;
        if (!this.runs.complete(run, detached && !attached)) {
            return;
        }
        this.view.completed(run);
        this.view.changed();
        if (detached) {
            this.view.finishedDetached(run, attached);
        }
    }

    discard(run: ManagedAgentRun<TState>) {
        this.runs.complete(run, false);
        this.view.discarded(run, this.isCurrent(run));
        this.view.changed();
    }

    private hasUnrenderedInteraction(run: ManagedAgentRun<TState>): boolean {
        return run.pendingInteractions.some(event => !run.renderedInteractionKeys.has(this.interactionKey(event)));
    }

    private async replay(run: ManagedAgentRun<TState>) {
        run.replaying = true;
        this.restore(run);
        run.interactionViewReady = true;
        this.view.startReplay(run);
        try {
            while (this.isCurrent(run) && run.interactionViewReady && this.runs.get(run.sessionID) === run) {
                const events = this.runs.drain(run);
                for (const event of events) {
                    if (event.type === "content") {
                        this.view.prepareReplayContent();
                    }
                    await this.view.handleEvent(event);
                    if (!this.isCurrent(run) || !run.interactionViewReady || this.runs.get(run.sessionID) !== run) {
                        return;
                    }
                }
                await this.renderPendingInteractions(run);
                if (run.pendingEvents.length === 0 && !this.hasUnrenderedInteraction(run)) {
                    run.detached = false;
                    this.view.idleReplay();
                    return;
                }
            }
        } finally {
            run.replaying = false;
            if (!this.isCurrent(run) || !run.interactionViewReady) {
                run.detached = true;
                run.interactionViewReady = false;
            }
        }
    }

    attach(run: ManagedAgentRun<TState>) {
        if (this.runs.get(run.sessionID) !== run) {
            this.view.recoverUnavailable(run);
            return;
        }
        if (run.replayPromise) {
            return;
        }
        const replayPromise = this.replay(run).catch(e => {
            console.error("replay background agent events failed:", e);
        });
        run.replayPromise = replayPromise;
        void replayPromise.finally(() => {
            if (run.replayPromise === replayPromise) {
                run.replayPromise = undefined;
            }
        });
    }
}
