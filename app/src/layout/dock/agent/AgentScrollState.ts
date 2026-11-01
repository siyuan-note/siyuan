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

export interface AgentThinkingAnchorMetrics {
    cardTop: number;
    cardBottom: number;
    containerTop: number;
    scrollTop: number;
}

// 折叠思考卡片把正文那一整段高度抽掉，卡片会整个滑到滚动区上沿之上：粘性标题跟着卡片离开视野，
// 卡片后面的输出也跳到看不见的位置。这里返回把卡片顶沿对回滚动区上沿的目标 scrollTop，
// 标题重新贴住面板顶部、输出正好落在它下面。
// 卡片还露在视野里时返回 undefined，不动滚动位置，那时它自己就是用户的参照物。
export const resolveThinkingCardAnchor = (metrics: AgentThinkingAnchorMetrics): number | undefined => {
    if (metrics.cardBottom > metrics.containerTop) {
        return undefined;
    }
    return Math.max(0, metrics.scrollTop + metrics.cardTop - metrics.containerTop);
};
