const settleDockAnimations = async () => {
    await new Promise(resolve => setTimeout(resolve, 350));
    let frame;
    let timer;
    let stopped = false;
    try {
        await Promise.race([new Promise((_, reject) => {
            // 渲染暂停时帧回调可能不执行，超时不能依赖下一帧。
            timer = setTimeout(() => {
                const docks = Array.from(document.querySelectorAll(".dock")).map(element => ({
                    id: element.id,
                    className: element.className,
                    opacity: getComputedStyle(element).opacity,
                    transform: getComputedStyle(element).transform,
                }));
                reject(new Error(`dock animations did not settle within five seconds: ${JSON.stringify(docks)}`));
            }, 5000);
        }), (async () => {
            let idleFrames = 0;
            while (!stopped && idleFrames < 2) {
                // 跟随动画在下一帧建立；连续空闲帧也覆盖 finished 回调中的状态清理。
                await new Promise(resolve => {
                    frame = requestAnimationFrame(resolve);
                });
                const animations = document.getAnimations();
                const closing = document.querySelector(".dock--closing");
                const active = animations.some(animation => animation.pending || animation.playState === "running");
                idleFrames = active || closing ? 0 : idleFrames + 1;
            }
        })()]);
    } finally {
        stopped = true;
        clearTimeout(timer);
        cancelAnimationFrame(frame);
    }
};

module.exports = settleDockAnimations;
