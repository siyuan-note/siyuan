export const getMathRenderSecurity = (remoteKernel: boolean, safeRender: boolean) => ({
    trust: !remoteKernel && !safeRender,
    sanitize: remoteKernel || safeRender,
});
