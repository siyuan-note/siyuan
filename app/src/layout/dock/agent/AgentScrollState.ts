export type AgentScrollStateMode = "user" | "reconcile" | "restore";

export interface AgentScrollMetrics {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

export interface AgentScrollState {
    userScrolledUp: boolean;
    buttonVisible: boolean;
}

const scrollableThreshold = 1;
const leaveBottomThreshold = 60;
const returnBottomThreshold = 10;

export const resolveAgentScrollState = (
    metrics: AgentScrollMetrics,
    currentUserScrolledUp: boolean,
    mode: AgentScrollStateMode,
): AgentScrollState => {
    const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    const scrollTop = Math.min(maxScrollTop, Math.max(0, metrics.scrollTop));
    const distanceFromBottom = maxScrollTop - scrollTop;
    const scrollable = maxScrollTop > scrollableThreshold;
    let userScrolledUp = currentUserScrolledUp;

    if (!scrollable || distanceFromBottom <= returnBottomThreshold) {
        userScrolledUp = false;
    } else if (mode === "restore") {
        userScrolledUp = distanceFromBottom >= leaveBottomThreshold;
    } else if (mode === "user" && !userScrolledUp && distanceFromBottom >= leaveBottomThreshold) {
        userScrolledUp = true;
    }

    return {
        userScrolledUp,
        buttonVisible: userScrolledUp && scrollable && distanceFromBottom > returnBottomThreshold,
    };
};
