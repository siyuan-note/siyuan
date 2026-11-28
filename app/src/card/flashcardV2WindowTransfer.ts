import type {IFlashcardV2SessionTransfer} from "./flashcardV2Session";

const waitForWindow = 15000;

export const sendFlashcardReviewToWindow = (id: string, state: IFlashcardV2SessionTransfer,
    open: () => void, takeOwnership: () => (() => void) | undefined) => new Promise<boolean>((resolve, reject) => {
    const channel = new BroadcastChannel("siyuan-flashcard-review:" + id);
    const finish = (moved: boolean) => {
        clearTimeout(timer);
        channel.close();
        resolve(moved);
    };
    const timer = setTimeout(() => finish(false), waitForWindow);
    let delivered = false;
    channel.onmessage = ({data}) => {
        if (data === "ready" && !delivered) {
            delivered = true;
            channel.postMessage({state});
        } else if (data === "received" && delivered) {
            const closeSource = takeOwnership();
            if (!closeSource) {
                channel.postMessage("cancel");
                finish(false);
                return;
            }
            channel.postMessage("continue");
            finish(true);
            closeSource();
        }
    };
    try {
        open();
    } catch (error) {
        clearTimeout(timer);
        channel.close();
        reject(error);
    }
});

export const receiveFlashcardReviewInWindow = (id: string, signal: AbortSignal,
    receive: (state: IFlashcardV2SessionTransfer) => void, unavailable: () => void) => {
    if (signal.aborted) { return; }
    const channel = new BroadcastChannel("siyuan-flashcard-review:" + id);
    const close = () => {
        clearTimeout(timer);
        channel.close();
        signal.removeEventListener("abort", close);
    };
    const failed = () => {
        close();
        unavailable();
    };
    const timer = setTimeout(failed, waitForWindow);
    let state: IFlashcardV2SessionTransfer;
    channel.onmessage = ({data}) => {
        if (data?.state && !state) {
            state = data.state;
            channel.postMessage("received");
        } else if (data === "continue" && state) {
            close();
            receive(state);
        } else if (data === "cancel") {
            failed();
        }
    };
    signal.addEventListener("abort", close, {once: true});
    channel.postMessage("ready");
};
