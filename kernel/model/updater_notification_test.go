package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type installPackageNotification struct {
	Cmd  string
	Msg  string
	Data struct {
		ID string
	}
}

// installPackageNotifications 按连接顺序读取屏障前的全部通知，避免用超时判断消息缺失。
func installPackageNotifications(t *testing.T) func() []installPackageNotification {
	t.Helper()
	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = push.HandleRequest(w, r)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { _ = push.Close() })
	connection, response, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(server.URL, "http")+"/ws?app=updater-notification-test&id=main&type=main", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	t.Cleanup(func() { _ = connection.Close() })
	select {
	case session := <-connected:
		t.Cleanup(func() { util.RemovePushChan(session) })
	case <-time.After(5 * time.Second):
		t.Fatal("notification connection was not registered")
	}
	return func() (events []installPackageNotification) {
		t.Helper()
		if err := push.Broadcast([]byte(`{"cmd":"updater-notification-barrier"}`)); err != nil {
			t.Fatal(err)
		}
		if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		for {
			var event installPackageNotification
			if err := connection.ReadJSON(&event); err != nil {
				t.Fatal(err)
			}
			if event.Cmd == "updater-notification-barrier" {
				return
			}
			events = append(events, event)
		}
	}
}

func TestInstallPackageCheckNotifications(t *testing.T) {
	if currentInstallPackageSuffix() == "" {
		t.Skip("automatic installation is desktop-only")
	}
	for _, scenario := range []string{"busy", "ready", "legacy"} {
		t.Run(scenario, func(t *testing.T) {
			dir := prepareInstallPackageTest(t)
			originalLangs := util.Langs
			util.Langs = map[string]map[int]string{"en": {62: "Ready", 103: "Downloading", 104: "Failed", 421: "Busy"}}
			t.Cleanup(func() { util.Langs = originalLangs })
			Conf.Lang = "en"
			Conf.System.Load().UpdateChannel = conf.UpdateChannelAlpha
			metadata := &installPackageMetadata{FormatVersion: installPackageMetadataVersion,
				Version: "99.0.0", Channel: conf.UpdateChannelAlpha,
				FileName: "siyuan-99.0.0-" + currentInstallPackageSuffix(),
				Checksum: fmt.Sprintf("%x", sha256.Sum256([]byte("complete package")))}
			githubReleasesLock.Lock()
			originalReleases, originalCacheTime := cachedGitHubReleases, githubReleasesCacheTime
			cachedGitHubReleases = []*githubRelease{{TagName: "v99.0.0", Assets: []*githubReleaseAsset{{
				Name: metadata.FileName, BrowserDownloadURL: "http://127.0.0.1:0/package",
				Digest: "sha256:" + metadata.Checksum, State: "uploaded",
			}}}}
			githubReleasesCacheTime = time.Now().Unix()
			githubReleasesLock.Unlock()
			t.Cleanup(func() {
				githubReleasesLock.Lock()
				cachedGitHubReleases, githubReleasesCacheTime = originalReleases, originalCacheTime
				githubReleasesLock.Unlock()
			})
			if scenario == "busy" {
				lock, err := tryInstallPackageDownloadLock(dir)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = lock.Close() })
			} else {
				if scenario == "legacy" {
					dir = filepath.Join(util.TempDir, "install")
					if err := os.MkdirAll(dir, 0700); err != nil {
						t.Fatal(err)
					}
				}
				installPackageFixture(t, dir, metadata.Version, metadata.Channel, currentInstallPackageSuffix())
			}
			read := installPackageNotifications(t)
			for _, notifyUnavailable := range []bool{false, true} {
				checkDownloadInstallPkg(notifyUnavailable)
				events := read()
				want, wantID := "Ready", "update-pkg-ready"
				if scenario == "busy" {
					want, wantID = "Busy", "update-pkg-downloading"
				}
				if len(events) != 1 || events[0].Cmd != "msg" || events[0].Msg != want || events[0].Data.ID != wantID {
					t.Fatalf("unexpected %s notifications: %+v", scenario, events)
				}
			}
		})
	}
}

func TestInstallPackageDownloadStartNotification(t *testing.T) {
	prepareInstallPackageTest(t)
	originalLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {62: "Ready", 103: "Downloading", 133: "Progress %s"}}
	t.Cleanup(func() { util.Langs = originalLangs })
	Conf.Lang = "en"
	read := installPackageNotifications(t)
	metadata := &installPackageMetadata{FormatVersion: installPackageMetadataVersion,
		Version: "99.0.0", Channel: conf.UpdateChannelStable, FileName: "siyuan-99.0.0-win.exe",
		Checksum: fmt.Sprintf("%x", sha256.Sum256([]byte("complete package")))}
	started, resume := make(chan struct{}), make(chan struct{})
	var resumeOnce sync.Once
	var startOnce sync.Once
	release := func() { resumeOnce.Do(func() { close(resume) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startOnce.Do(func() { close(started) })
		<-resume
		fmt.Fprint(w, "complete package")
	}))
	t.Cleanup(server.Close)
	done := make(chan error, 1)
	go func() { done <- downloadInstallPkg(server.URL, metadata) }()
	finished := false
	t.Cleanup(func() {
		release()
		if !finished {
			<-done
		}
	})
	select {
	case <-started:
	case err := <-done:
		finished = true
		t.Fatalf("download ended before its network request: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("download did not start")
	}
	events := read()
	if len(events) != 1 || events[0].Cmd != "msg" || events[0].Msg != "Downloading" || events[0].Data.ID != "update-pkg-downloading" {
		t.Fatalf("missing download start notification: %+v", events)
	}
	lock, err := tryInstallPackageDownloadLock(sharedInstallPackageDir())
	if !errors.Is(err, errInstallPackageDownloadBusy) {
		if lock != nil {
			_ = lock.Close()
		}
		t.Fatalf("download start notification was sent without holding the download lock: %v", err)
	}
	release()
	err = <-done
	finished = true
	if err != nil {
		t.Fatal(err)
	}
	ready := false
	for _, event := range read() {
		ready = ready || event.Cmd == "statusbar" && strings.HasPrefix(event.Msg, "Ready (")
	}
	if !ready {
		t.Fatal("completed download did not report a ready package")
	}
	if err = downloadInstallPkg(server.URL, metadata); err != nil {
		t.Fatal(err)
	}
	if events = read(); len(events) != 0 {
		t.Fatalf("reusing a ready package emitted download notifications: %+v", events)
	}
}
