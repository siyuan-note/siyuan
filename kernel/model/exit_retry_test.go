package model

import (
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
	"net/http/httptest"
	"os"
	"testing"
)

func TestWorkspaceExitRecoveryGuards(t *testing.T) {
	previous, previousFinished := pendingWorkspaceExit, exitFinished
	container, attached := util.Container, util.AttachUI
	t.Cleanup(func() {
		pendingWorkspaceExit, exitFinished = previous, previousFinished
		util.Container, util.AttachUI = container, attached
	})
	util.Container, util.AttachUI = util.ContainerStd, true
	exitFinished = false
	pendingWorkspaceExit = &util.WorkspaceExitState{PID: os.Getpid(), StartedAt: 123, Phase: "waiting"}
	for _, expected := range []*util.WorkspaceExitState{{PID: os.Getpid() + 1, StartedAt: 123}, {PID: os.Getpid(), StartedAt: 124}} {
		if code, _ := RecoverWorkspaceExit(expected.PID, expected.StartedAt); code != -1 {
			t.Fatalf("mismatched exit accepted: %d", code)
		}
	}
	session := &melody.Session{Request: httptest.NewRequest("GET", "/ws?app=exit-recovery-test&id=main&type=main", nil)}
	util.AddPushChan(session)
	t.Cleanup(func() { util.RemovePushChan(session) })
	if code, _ := RecoverWorkspaceExit(os.Getpid(), 123); code != 3 {
		t.Fatalf("active window lost its exit: %d", code)
	}
	util.RemovePushChan(session)
	if code := workspaceExitRecoveryCode(pendingWorkspaceExit); code != 0 {
		t.Fatalf("orphan exit not eligible: %d", code)
	}
	util.AttachUI = false
	if code := workspaceExitRecoveryCode(pendingWorkspaceExit); code != -1 {
		t.Fatalf("headless kernel accepted: %d", code)
	}
	util.AttachUI = true
	exitFinished = true
	if code, _ := RecoverWorkspaceExit(os.Getpid(), 123); code != 0 {
		t.Fatalf("completed recovery was not idempotent: %d", code)
	}
}

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
