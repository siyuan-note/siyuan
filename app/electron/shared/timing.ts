// 等待指定毫秒。轮询与重试都用它表达节奏，需要虚拟时间的测试通过各自的注入点替换实现。

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export {sleep};
