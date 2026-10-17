package model

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWorkspaceExitRetryPreservesBatch(t *testing.T) {
	previous, temp := pendingWorkspaceExit, util.TempDir
	t.Cleanup(func() { pendingWorkspaceExit, util.TempDir = previous, temp })
	util.TempDir = t.TempDir()
	pendingWorkspaceExit = nil
	markPendingWorkspaceExit()
	batch := pendingWorkspaceExit
	batch.SetPhase("waiting")
	time.Sleep(2 * time.Millisecond)
	markPendingWorkspaceExit()
	if pendingWorkspaceExit != batch {
		t.Fatal("background retry replaced the recoverable exit batch")
	}
	data, err := os.ReadFile(filepath.Join(util.TempDir, "kernel-exit.json"))
	if err != nil {
		t.Fatal(err)
	}
	var marker util.WorkspaceExitState
	if err = json.Unmarshal(data, &marker); err != nil || marker.StartedAt != batch.StartedAt || marker.Phase != "exiting" {
		t.Fatalf("retry marker changed identity: %s (%v)", data, err)
	}
}

func TestExitSyncSkippedAndFailed(t *testing.T) {
	prepareSyncDirectoryTest(t)
	previousErrors := autoSyncErrCount.Load()
	t.Cleanup(func() { autoSyncErrCount.Store(previousErrors) })
	for _, mode := range []int{0, 3} {
		Conf.Sync.Load().Enabled = mode != 0
		Conf.Sync.Load().Mode = mode
		if err := syncData(true, false); err != nil {
			t.Fatalf("skipped exit sync reported a failure: %v", err)
		}
	}
	Conf.Sync.Load().Mode = 1
	Conf.Sync.Load().Enabled = true
	Conf.SetUser(&conf.User{UserId: "sync-test", UserSiYuanOneTimePayStatus: 1})
	Conf.Repo.Load().Key = nil
	Conf.Sync.Load().Perception = false
	autoSyncErrCount.Store(8)
	if !checkSync(false, true, false) {
		t.Fatal("exit retry was blocked by automatic sync backoff")
	}
	if err := syncData(true, false); err == nil {
		t.Fatal("repository initialization failure was reported as successful exit sync")
	}
	Conf.Sync.Load().Enabled = false
	if err := syncData(true, false); err != nil {
		t.Fatalf("previous sync failure leaked into a skipped sync: %v", err)
	}
}

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
		if code, _ := RecoverWorkspaceExit(expected.PID, expected.StartedAt, true); code != -1 {
			t.Fatalf("mismatched exit accepted: %d", code)
		}
	}
	session := &melody.Session{Request: httptest.NewRequest("GET", "/ws?app=exit-recovery-test&id=main&type=main", nil)}
	util.AddPushChan(session)
	t.Cleanup(func() { util.RemovePushChan(session) })
	if code, _ := RecoverWorkspaceExit(os.Getpid(), 123, true); code != 3 {
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
	if code, _ := RecoverWorkspaceExit(os.Getpid(), 123, true); code != 0 {
		t.Fatalf("completed recovery was not idempotent: %d", code)
	}
}

func TestExitKernelPreservesMobileConfirmation(t *testing.T) {
	previousFinished, previousStarted := exitFinished, exitServersStarted
	previousContainer, previousHTTP, previousHTTPS := util.Container, util.HttpServer, util.HttpsServer
	t.Cleanup(func() {
		exitFinished, exitServersStarted = previousFinished, previousStarted
		util.Container, util.HttpServer, util.HttpsServer = previousContainer, previousHTTP, previousHTTPS
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "exit confirmation")
	}))
	t.Cleanup(server.Close)
	util.HttpServer, util.HttpsServer = server.Config, nil
	for _, container := range []string{util.ContainerAndroid, util.ContainerIOS, util.ContainerHarmony} {
		util.Container = container
		exitFinished, exitServersStarted = false, false
		ExitKernel()
		if exitServersStarted {
			t.Fatal("server shutdown started before cleanup completed")
		}
		exitFinished = true
		ExitKernel()
		ExitKernel()
		if !exitServersStarted {
			t.Fatal("completed exit was not recorded")
		}
	}
	// 原生宿主尚未退出时，即使超过事件等待时间，也能重试退出确认请求。
	time.Sleep(650 * time.Millisecond)
	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatalf("mobile exit confirmation channel was closed: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "exit confirmation" {
		t.Fatalf("mobile exit confirmation was lost: %q (%v)", body, err)
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

func TestExitKernelWaitsForDeferredCleanup(t *testing.T) {
	previousFinished, previousStarted, previousContainer := exitFinished, exitServersStarted, util.Container
	t.Cleanup(func() {
		exitFinished, exitServersStarted, util.Container = previousFinished, previousStarted, previousContainer
	})
	util.Container = util.ContainerAndroid
	exitFinished, exitServersStarted = true, false
	exitLock.Lock()
	finished := make(chan struct{})
	go func() {
		ExitKernel()
		close(finished)
	}()
	// 退出锁覆盖所有 defer 清理，服务退出必须等待锁释放。
	select {
	case <-finished:
		exitLock.Unlock()
		t.Fatal("server shutdown bypassed deferred cleanup")
	case <-time.After(650 * time.Millisecond):
	}
	if exitServersStarted {
		exitLock.Unlock()
		t.Fatal("server shutdown started while cleanup held the exit lock")
	}
	exitLock.Unlock()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("completed cleanup did not allow server shutdown")
	}
	if !exitServersStarted {
		t.Fatal("completed cleanup did not record the exit")
	}
}
