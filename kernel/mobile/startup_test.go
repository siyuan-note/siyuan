package mobile

import (
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func waitMobileStartupSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("mobile startup did not advance")
	}
}

func TestIOSStartupOpensLocalDataBeforeCloudSync(t *testing.T) {
	uiReady := make(chan struct{})
	syncStarted := make(chan struct{})
	syncRelease := make(chan struct{})
	defer close(syncRelease)
	localBootFinished := make(chan struct{})

	finishMobileStartup(util.ContainerIOS, func() {
		close(syncStarted)
		<-syncRelease
	}, func() {
		close(localBootFinished)
	}, func() {
		<-uiReady
	})

	waitMobileStartupSignal(t, localBootFinished)
	select {
	case <-syncStarted:
		t.Fatal("iOS sync started before the UI was ready")
	default:
	}
	close(uiReady)
	waitMobileStartupSignal(t, syncStarted)
}

func TestAndroidStartupWaitsForBootSync(t *testing.T) {
	syncStarted := make(chan struct{})
	syncRelease := make(chan struct{})
	var release sync.Once
	closeSync := func() { release.Do(func() { close(syncRelease) }) }
	defer closeSync()
	localBootFinished := make(chan struct{})
	startupReturned := make(chan struct{})

	go func() {
		finishMobileStartup(util.ContainerAndroid, func() {
			close(syncStarted)
			<-syncRelease
		}, func() {
			close(localBootFinished)
		}, func() {
			t.Error("Android startup waited for the UI")
		})
		close(startupReturned)
	}()

	waitMobileStartupSignal(t, syncStarted)
	select {
	case <-localBootFinished:
		t.Fatal("Android local boot finished before boot sync")
	default:
	}
	closeSync()
	waitMobileStartupSignal(t, localBootFinished)
	waitMobileStartupSignal(t, startupReturned)
}
