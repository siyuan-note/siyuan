// 通过开发者工具的 performance.mark("siyuan-performance") 临时启用，不持久化用户偏好。
export const beginPerformance = (operation: string) => {
    if (!performance.getEntriesByName("siyuan-performance", "mark").length) {
        return undefined;
    }
    const started = performance.now();
    let previous = started;
    let stage = "prepare";
    let finished = false;
    const stages: Record<string, number> = {};
    const counts: Record<string, number> = {};
    const nextStage = (name: string) => {
        if (finished) {
            return;
        }
        const now = performance.now();
        stages[stage] = (stages[stage] || 0) + Math.round((now - previous) * 1000);
        previous = now;
        stage = name;
    };
    return {
        stage: nextStage,
        count(name: string, value: number) {
            if (!finished) {
                counts[name] = value;
            }
        },
        finish() {
            if (finished) {
                return;
            }
            nextStage("finished");
            finished = true;
            console.info("siyuan-performance " + JSON.stringify({
                operation,
                duration_us: Math.round((previous - started) * 1000),
                stages_us: stages,
                counts,
            }));
        },
    };
};
