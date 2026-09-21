package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type syncPerceptionTestClient struct {
	t       *testing.T
	repo    *dejavu.Repo
	context map[string]any
}

func newSyncPerceptionTestClients(t *testing.T, mode int) (a, b, c *syncPerceptionTestClient) {
	t.Helper()
	previousConf := Conf
	Conf = &AppConf{Lang: "en"}
	t.Cleanup(func() { Conf = previousConf })
	root := t.TempDir()
	endpoint := filepath.Join(root, "cloud")
	newClient := func(name string) *syncPerceptionTestClient {
		backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{
			Dir: "main", Local: &cloud.ConfLocal{Endpoint: endpoint},
		}})
		client := newSyncPerceptionTestClient(t, filepath.Join(root, name), name, backend, mode)
		client.write("doc.txt", "base document", 0)
		client.write("local.txt", "base local", 0)
		client.write("remote.txt", "base remote", 0)
		client.index()
		if _, _, _, err := syncRepoWithPublication(client.repo, client.context); err != nil {
			t.Fatal(err)
		}
		return client
	}
	a, b, c = newClient("a"), newClient("b"), newClient("c")
	return
}

func newSyncPerceptionTestClient(t *testing.T, root, name string, backend cloud.Cloud, mode int) *syncPerceptionTestClient {
	t.Helper()
	repo, err := dejavu.NewRepo(filepath.Join(root, "data"), filepath.Join(root, "repo"),
		filepath.Join(root, "history"), filepath.Join(root, "temp"), name, name, "windows",
		[]byte("0123456789abcdef0123456789abcdef"), nil, backend)
	if err != nil {
		t.Fatal(err)
	}
	if mode >= 0 {
		if err = repo.ConfigureAssetDownloads(mode == 1, filepath.Join(root, "asset-downloads.json"), "test-cloud"); err != nil {
			t.Fatal(err)
		}
	}
	return &syncPerceptionTestClient{t: t, repo: repo, context: map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToNone}}
}

func (client *syncPerceptionTestClient) write(name, content string, minute int) {
	client.t.Helper()
	absPath := filepath.Join(client.repo.DataPath, name)
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		client.t.Fatal(err)
	}
	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		client.t.Fatal(err)
	}
	stamp := time.Unix(1700000000, 0).Add(time.Duration(minute) * time.Minute)
	if err := os.Chtimes(absPath, stamp, stamp); err != nil {
		client.t.Fatal(err)
	}
}

func (client *syncPerceptionTestClient) index() {
	client.t.Helper()
	if _, err := client.repo.Index("perception test", true, client.context); err != nil {
		client.t.Fatal(err)
	}
}

func (client *syncPerceptionTestClient) sync(wantPublication bool, wantConflicts int) *dejavu.MergeResult {
	client.t.Helper()
	client.index()
	merge, _, published, err := syncRepoWithPublication(client.repo, client.context)
	if err != nil {
		client.t.Fatal(err)
	}
	if published != wantPublication || merge.ConflictCount() != wantConflicts {
		client.t.Fatalf("client %s: published=%v conflicts=%d, want %v/%d", client.repo.DeviceID,
			published, merge.ConflictCount(), wantPublication, wantConflicts)
	}
	if _, ok := client.context[syncCloudRefContextKey]; ok {
		client.t.Fatal("publication state leaked into the reusable context")
	}
	return merge
}

func (client *syncPerceptionTestClient) assertContent(name, want string) {
	client.t.Helper()
	content, err := os.ReadFile(filepath.Join(client.repo.DataPath, name))
	if err != nil || string(content) != want {
		client.t.Fatalf("client %s file %s: %q, %v; want %q", client.repo.DeviceID, name, content, err, want)
	}
}

func TestSyncPerceptionReadOnlyPeersConverge(t *testing.T) {
	for _, mode := range []int{-1, 0, 1} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			a, b, c := newSyncPerceptionTestClients(t, mode)
			a.write("doc.txt", "published document", 10)
			a.sync(true, 0)
			for _, peer := range []*syncPerceptionTestClient{b, c} {
				merge := peer.sync(false, 0)
				if len(merge.Upserts) != 1 {
					t.Fatalf("expected one downloaded file, got %d", len(merge.Upserts))
				}
				peer.assertContent("doc.txt", "published document")
			}
			// 所有设备再次接到通知时都不发布，下载本身不会形成通知循环。
			for _, peer := range []*syncPerceptionTestClient{a, b, c} {
				peer.sync(false, 0)
			}
		})
	}
}

func TestSyncPerceptionMergesIndependentChanges(t *testing.T) {
	for _, mode := range []int{-1, 0, 1} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			a, b, c := newSyncPerceptionTestClients(t, mode)
			a.write("remote.txt", "remote edit", 10)
			a.sync(true, 0)
			b.write("local.txt", "unpublished local edit", 11)
			b.write("new.txt", "unpublished new document", 11)
			b.sync(true, 0)
			a.sync(false, 0)
			c.sync(false, 0)
			for _, peer := range []*syncPerceptionTestClient{a, b, c} {
				peer.assertContent("remote.txt", "remote edit")
				peer.assertContent("local.txt", "unpublished local edit")
				peer.assertContent("new.txt", "unpublished new document")
				peer.sync(false, 0)
			}
		})
	}
}

func TestSyncPerceptionPreservesRealConflictHistory(t *testing.T) {
	a, b, c := newSyncPerceptionTestClients(t, 0)
	a.write("doc.txt", "remote edit", 10)
	a.sync(true, 0)
	b.write("doc.txt", "local edit", 11)
	merge := b.sync(true, 1)
	if !merge.HasHistory() || len(merge.ConflictPaths()) != 1 || merge.ConflictPaths()[0] != "/doc.txt" {
		t.Fatalf("real conflict was not preserved: %+v", merge)
	}
	history, err := filepath.Glob(filepath.Join(b.repo.HistoryPath, "*-sync", "doc.txt"))
	if err != nil || len(history) != 1 {
		t.Fatalf("expected conflict history, got %v, %v", history, err)
	}
	content, err := os.ReadFile(history[0])
	if err != nil || string(content) != "remote edit" {
		t.Fatalf("unexpected conflict history: %q, %v", content, err)
	}
	b.assertContent("doc.txt", "local edit")
	a.sync(false, 0)
	c.sync(false, 0)
}

func TestSyncPerceptionDelayedNotificationPreservesLocalEdit(t *testing.T) {
	a, b, _ := newSyncPerceptionTestClients(t, 0)
	a.write("doc.txt", "published document", 10)
	a.sync(true, 0)
	latest, err := a.repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	b.sync(false, 0)
	a.write("doc.txt", "still editing locally", 11)
	a.index()

	prepareSyncDirectoryTest(t)
	Conf.Sync.Provider, Conf.Sync.CloudName, Conf.Sync.Enabled = conf.ProviderLocal, "main", true
	Conf.Sync.Local = &conf.Local{Endpoint: "perception-test"}
	Conf.User = &conf.User{UserId: "perception-test", UserSiYuanOneTimePayStatus: 1}
	util.RepoDir = a.repo.Path
	previousRequests := syncRemoteRequests
	t.Cleanup(func() { syncRemoteRequests = previousRequests })
	syncRemoteRequests = newSyncRemoteDeduper(time.Minute)
	scope := lanSyncScope()
	for _, mode := range []int{2, 3} {
		Conf.Sync.Mode = mode
		syncDataFromRemote(scope, latest.ID)
		if syncRemoteRequests.isCompleted(scope, latest.ID) {
			t.Fatal("skipped automatic sync was recorded as completed")
		}
	}
	Conf.Sync.Mode = 1
	for range 2 {
		// 丢弃内存缓存模拟进程重启，仍需通过持久化同步点识别延迟及重复通知。
		syncRemoteRequests = newSyncRemoteDeduper(time.Minute)
		for range 2 {
			syncDataFromRemote(lanSyncScope(), latest.ID)
			a.assertContent("doc.txt", "still editing locally")
			if Conf.Sync.Synced != 0 {
				t.Fatal("already applied cloud version started another sync")
			}
		}
	}
	if applied, readErr := syncCloudAlreadyApplied(a.repo.Path, "different-commit"); applied || readErr != nil {
		t.Fatalf("a new cloud version was ignored: %v, %v", applied, readErr)
	}
}

type syncPerceptionFailingCloud struct {
	*cloud.Local
	failRef bool
}

func (backend *syncPerceptionFailingCloud) UploadObject(path string, overwrite bool) (int64, error) {
	if backend.failRef && filepath.ToSlash(path) == "refs/latest" {
		return 0, errors.New("injected ref upload failure")
	}
	return backend.Local.UploadObject(path, overwrite)
}

func TestSyncPerceptionFailedPublicationCanRetry(t *testing.T) {
	previousConf := Conf
	Conf = &AppConf{Lang: "en"}
	t.Cleanup(func() { Conf = previousConf })
	root := t.TempDir()
	backend := &syncPerceptionFailingCloud{Local: cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{
		Dir: "main", Local: &cloud.ConfLocal{Endpoint: filepath.Join(root, "cloud")},
	}}), failRef: true}
	client := newSyncPerceptionTestClient(t, filepath.Join(root, "client"), "client", backend, 0)
	client.write("doc.txt", "local document", 0)
	client.index()
	_, traffic, published, err := syncRepoWithPublication(client.repo, client.context)
	if err == nil || published || traffic == nil || traffic.UploadFileCount == 0 {
		t.Fatalf("failed ref upload reported publication: %v, %+v, %v", published, traffic, err)
	}
	backend.failRef = false
	client.sync(true, 0)
	client.sync(false, 0)
}

func TestSyncPerceptionManualDownloadStillOverwrites(t *testing.T) {
	a, _, _ := newSyncPerceptionTestClients(t, 0)
	a.write("doc.txt", "cloud document", 10)
	a.sync(true, 0)
	for minute := 11; minute < 13; minute++ {
		a.write("doc.txt", "unpublished edit", minute)
		a.index()
		merge, _, err := a.repo.SyncDownload(a.context)
		if err != nil || merge.ConflictCount() != 1 || !merge.HasHistory() {
			t.Fatalf("explicit download lost its overwrite semantics: %+v, %v", merge, err)
		}
		a.assertContent("doc.txt", "cloud document")
	}
}

func TestSyncPerceptionUnreadableSyncPoint(t *testing.T) {
	root := t.TempDir()
	if applied, err := syncCloudAlreadyApplied(root, "latest"); applied || err != nil {
		t.Fatalf("missing sync point: %v, %v", applied, err)
	}
	if err := os.MkdirAll(filepath.Join(root, "refs", "latest-sync"), 0755); err != nil {
		t.Fatal(err)
	}
	if applied, err := syncCloudAlreadyApplied(root, "latest"); applied || err == nil {
		t.Fatalf("unreadable sync point: %v, %v", applied, err)
	}
}

func TestSyncPerceptionDeletionPublishes(t *testing.T) {
	a, b, _ := newSyncPerceptionTestClients(t, 0)
	if err := os.Remove(filepath.Join(a.repo.DataPath, "doc.txt")); err != nil {
		t.Fatal(err)
	}
	a.sync(true, 0)
	merge := b.sync(false, 0)
	if len(merge.Removes) != 1 {
		t.Fatalf("expected one downloaded deletion, got %d", len(merge.Removes))
	}
	if _, err := os.Stat(filepath.Join(b.repo.DataPath, "doc.txt")); !os.IsNotExist(err) {
		t.Fatalf("remote deletion was not applied: %v", err)
	}
}
