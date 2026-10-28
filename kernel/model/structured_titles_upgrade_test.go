// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type structuredTitlesLegacyFixture struct {
	Password  string `json:"password"`
	Documents []struct {
		Notebook  string `json:"notebook"`
		ID        string `json:"id"`
		ParentID  string `json:"parentID"`
		Path      string `json:"path"`
		Title     string `json:"title"`
		Encrypted bool   `json:"encrypted"`
	} `json:"documents"`
	SHA256 map[string]string `json:"sha256"`
}

func loadStructuredTitlesLegacyFixture(t *testing.T) (string, structuredTitlesLegacyFixture) {
	t.Helper()
	directory := filepath.Join("testdata", "structured_titles_legacy")
	data, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture structuredTitlesLegacyFixture
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Documents) != 4 || len(fixture.SHA256) == 0 {
		t.Fatal("legacy fixture is incomplete")
	}
	for name, expected := range fixture.SHA256 {
		data, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != expected {
			t.Fatalf("released fixture changed: %s", name)
		}
	}
	return directory, fixture
}

func TestStructuredTitlesReleasedDataUpgradeAndRestart(t *testing.T) {
	directory, fixture := loadStructuredTitlesLegacyFixture(t)
	const rootVariable = "SIYUAN_TEST_RELEASED_TITLES_ROOT"
	root := os.Getenv(rootVariable)
	if root == "" {
		root = t.TempDir()
		if err := os.CopyFS(filepath.Join(root, "data"), os.DirFS(filepath.Join(directory, "data"))); err != nil {
			t.Fatal(err)
		}
		for _, phase := range []string{"upgrade", "restart"} {
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStructuredTitlesReleasedDataUpgradeAndRestart$", "-test.v")
			command.Env = append(os.Environ(), rootVariable+"="+root)
			output, err := command.CombinedOutput()
			cancel()
			if err != nil {
				t.Fatalf("%s: %v\n%s", phase, err, output)
			}
		}
		return
	}

	// 每个进程使用全新索引，只有旧文档及迁移后的持久记录跨进程保存。
	prepareHPathRefreshTest(t)
	t.Cleanup(backgroundRefreshWaitGroup.Wait)
	util.WorkspaceDir, util.DataDir, util.ConfDir = root, filepath.Join(root, "data"), filepath.Join(root, "conf")
	Conf.Flashcard.Store(conf.NewFlashcard())
	keyData, err := os.ReadFile(filepath.Join(directory, "notebook-crypto.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(keyData, &Conf.NotebookCrypto); err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(currentNotebookCrypto())
	boxes := map[string]bool{}
	for _, document := range fixture.Documents {
		boxes[document.Notebook] = document.Encrypted
	}
	for box, encrypted := range boxes {
		configPath := filepath.Join(util.DataDir, box, documentaddressing.ConfigPath)
		before, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatal(err)
		}
		if err = documentaddressing.CheckBox(box); err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatal(err)
		}
		var original, migrated map[string]any
		if json.Unmarshal(before, &original) != nil || json.Unmarshal(after, &migrated) != nil {
			t.Fatal("invalid notebook configuration")
		}
		delete(original, "documentAddressingVersion")
		delete(migrated, "documentAddressingVersion")
		if !reflect.DeepEqual(original, migrated) {
			t.Fatal("mode migration changed old configuration or key material")
		}
		if encrypted {
			crypt, err := GetBoxEncryption(box)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = UnlockAndMountBox(box, "incorrect-fixture-password", crypt); err == nil || IsBoxUnlocked(box) {
				t.Fatal("legacy encrypted notebook bypassed password authentication")
			}
			if _, err = UnlockAndMountBox(box, fixture.Password, crypt); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { LockBox(box) })
		} else if _, err = Mount(box); err != nil {
			t.Fatal(err)
		}
		indexBox(box)
		sql.FlushQueue()
		if treenode.DocumentMetadataState(box) != "ready" {
			t.Fatal("legacy source index was not rebuilt")
		}
	}
	for _, document := range fixture.Documents {
		tree, err := filesys.LoadTree(document.Notebook, document.Path, util.NewLute())
		if err != nil || tree.Root.Spec != "2" || tree.ID != document.ID || tree.Root.IALAttr("id") != document.ID ||
			treenode.ReadDocumentTitle(tree.Root).Text != document.Title {
			t.Fatalf("legacy document changed identity, title or specification: %s, %v", document.ID, err)
		}
		paths, missing, err := GetDocPaths(document.Notebook, []string{document.ID})
		if err != nil || len(missing) != 0 || len(paths) != 1 {
			t.Fatal("legacy document missing from rebuilt metadata", err)
		}
		parent := ""
		if paths[0].ParentID != nil {
			parent = *paths[0].ParentID
		}
		if paths[0].Title.Text != document.Title || parent != document.ParentID {
			t.Fatalf("legacy hierarchy or literal title changed: %+v", paths[0])
		}
		original, err := os.ReadFile(filepath.Join(directory, "data", document.Notebook, document.Path))
		if err != nil {
			t.Fatal(err)
		}
		current, err := os.ReadFile(filepath.Join(util.DataDir, document.Notebook, document.Path))
		if err != nil || !bytes.Equal(original, current) || util.IsCiphertext(current) != document.Encrypted {
			t.Fatal("upgrade or authenticated reindex rewrote a legacy source", err)
		}
	}
	afterKeys, _ := json.Marshal(currentNotebookCrypto())
	if !bytes.Equal(keys, afterKeys) {
		t.Fatal("upgrade changed the master salt, verifier or recovery keys")
	}
}

func TestStructuredTitlesSyncAndSnapshotKeepFixedCapabilities(t *testing.T) {
	const helper = "SIYUAN_TEST_RELEASED_TITLES_SYNC"
	if os.Getenv(helper) != "1" {
		// 同步事件及笔记本生命周期是进程级状态，不能继承其他模型用例的后台任务。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStructuredTitlesSyncAndSnapshotKeepFixedCapabilities$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("released-data sync: %v\n%s", err, output)
		}
		return
	}
	directory, fixture := loadStructuredTitlesLegacyFixture(t)
	full, receiver, fullData := prepareAssetDownloadRepoTest(t)
	backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: full.Path,
		AvailableSize: 1 << 30, Local: &cloud.ConfLocal{Endpoint: Conf.LoadSync().Local.Endpoint}}})
	sender, err := dejavu.NewRepoWithOptions(dejavu.Options{
		DataPath: full.DataPath, RepoPath: full.Path, HistoryPath: full.HistoryPath, TempPath: full.TempPath,
		DeviceID: full.DeviceID, DeviceName: full.DeviceName, DeviceOS: full.DeviceOS,
		AESKey: Conf.LoadRepo().Key, Cloud: backend, HiddenDirectoryNames: []string{".siyuan"},
	})
	if err != nil {
		t.Fatal(err)
	}
	boxes := map[string]bool{}
	for _, document := range fixture.Documents {
		boxes[document.Notebook] = true
	}
	for box := range boxes {
		if err = os.CopyFS(filepath.Join(fullData, box), os.DirFS(filepath.Join(directory, "data", box))); err != nil {
			t.Fatal(err)
		}
		// 旧样本与升级记录使用不同的秒级时间，避免测试准备阶段复用快照文件身份。
		if err = filepath.WalkDir(filepath.Join(fullData, box), func(name string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || entry.IsDir() {
				return walkErr
			}
			stamp := time.Unix(1700000000, 0)
			return os.Chtimes(name, stamp, stamp)
		}); err != nil {
			t.Fatal(err)
		}
	}
	synchronize := func(source *dejavu.Repo, memo string, target *dejavu.Repo) {
		t.Helper()
		if _, err := source.Index(memo, false, nil); err != nil {
			t.Fatalf("%s: index sender: %v", memo, err)
		}
		if _, _, err := source.Sync(nil); err != nil {
			t.Fatalf("%s: upload sender: %v", memo, err)
		}
		if _, _, err := target.Sync(nil); err != nil {
			t.Fatalf("%s: sync receiver: %v", memo, err)
		}
	}
	synchronize(sender, "released notebook data", receiver)
	legacy, err := receiver.Index("before automatic migration", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertUpgraded := func() {
		t.Helper()
		for box := range boxes {
			if err := documentaddressing.CheckBox(box); err != nil {
				t.Fatal(err)
			}
			snapshot, err := documentaddressing.InspectBox(box)
			if err != nil || snapshot.Mode != 2 {
				t.Fatal("sync or snapshot changed the fixed addressing version", snapshot, err)
			}
		}
		for _, document := range fixture.Documents {
			name := filepath.Join(document.Notebook, document.Path)
			original, err := os.ReadFile(filepath.Join(directory, "data", name))
			if err != nil {
				t.Fatal(err)
			}
			current, err := os.ReadFile(filepath.Join(receiver.DataPath, name))
			if err != nil || !bytes.Equal(original, current) {
				t.Fatal("sync or restoration changed a released source", name, err)
			}
		}
	}
	assertUpgraded()
	synchronize(receiver, "automatically upgraded records", sender)
	for box := range boxes {
		// 模拟对端传回未升级配置并删除笔记本下界，接收端须保留已确认的本机要求。
		original, err := os.ReadFile(filepath.Join(directory, "data", box, documentaddressing.ConfigPath))
		if err != nil {
			t.Fatal(err)
		}
		name := filepath.Join(sender.DataPath, box, documentaddressing.ConfigPath)
		if err = os.WriteFile(name, original, 0600); err != nil {
			t.Fatal(err)
		}
		stamp := time.Now().Add(5 * time.Second)
		if err = os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	synchronize(sender, "stale notebook configuration", receiver)
	for box := range boxes {
		if _, err = os.Stat(filepath.Join(receiver.DataPath, box, documentaddressing.FloorPath)); !os.IsNotExist(err) {
			t.Fatal("sync regenerated a retired notebook record", err)
		}
	}
	assertUpgraded()
	if _, _, err = receiver.Checkout(legacy.ID, nil); err != nil {
		t.Fatal(err)
	}
	assertUpgraded()
}
