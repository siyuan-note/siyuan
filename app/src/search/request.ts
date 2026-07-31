interface ISearchRequestTask {
    method: number,
    version: number,
    run: (signal: AbortSignal, isCurrent: () => boolean) => Promise<unknown> | void,
}

interface ISearchRequestState {
    version: number,
    timeout?: number,
    running?: {
        controller: AbortController,
        task: ISearchRequestTask,
    },
    queued?: ISearchRequestTask,
    onIdle?: () => void,
}

const requestStates = new WeakMap<Element, ISearchRequestState>();

const getRequestState = (element: Element) => {
    let state = requestStates.get(element);
    if (!state) {
        state = {
            version: 0,
        };
        requestStates.set(element, state);
    }
    return state;
};

const runRequestTask = (element: Element, state: ISearchRequestState, task: ISearchRequestTask) => {
    if (task.version !== state.version || !element.isConnected) {
        return;
    }
    const controller = new AbortController();
    const running = {
        controller,
        task,
    };
    state.running = running;
    const isCurrent = () => {
        return element.isConnected && state.version === task.version && state.running === running;
    };
    void Promise.resolve()
        .then(() => task.run(controller.signal, isCurrent))
        .finally(() => {
            if (state.running !== running) {
                return;
            }
            state.running = undefined;
            const queued = state.queued;
            state.queued = undefined;
            if (queued && queued.version === state.version) {
                runRequestTask(element, state, queued);
            } else if (state.timeout === undefined) {
                state.onIdle?.();
            }
        });
};

export const scheduleSearchRequest = (options: {
    element: Element,
    delay: number,
    createTask: (version: number) => ISearchRequestTask,
    onIdle: () => void,
}) => {
    const state = getRequestState(options.element);
    state.version++;
    state.queued = undefined;
    state.onIdle = options.onIdle;
    if (state.timeout !== undefined) {
        window.clearTimeout(state.timeout);
    }
    if (state.running?.task.method === 2) {
        state.running.controller.abort();
    }
    const version = state.version;
    state.timeout = window.setTimeout(() => {
        state.timeout = undefined;
        if (version !== state.version || !options.element.isConnected) {
            return;
        }
        const task = options.createTask(version);
        if (state.running) {
            state.queued = task;
        } else {
            runRequestTask(options.element, state, task);
        }
    }, options.delay);
};

export const cancelSearchRequest = (element: Element) => {
    const state = requestStates.get(element);
    if (!state) {
        return;
    }
    state.version++;
    state.queued = undefined;
    if (state.timeout !== undefined) {
        window.clearTimeout(state.timeout);
        state.timeout = undefined;
    }
    state.running?.controller.abort();
    state.running = undefined;
    requestStates.delete(element);
};
