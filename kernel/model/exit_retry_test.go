package model

import "testing"

func TestCompletedExitRetry(t *testing.T) {
	exitLock.Lock()
	previous := exitFinished
	exitFinished = true
	exitLock.Unlock()
	t.Cleanup(func() {
		exitLock.Lock()
		exitFinished = previous
		exitLock.Unlock()
	})
	// 已经完成的退出请求不能再次访问配置、数据库或临时状态。
	code, installPackage := Close(false, true, 0)
	if code != 0 || installPackage != "" {
		t.Fatalf("unexpected completed exit response: %d %q", code, installPackage)
	}
}
