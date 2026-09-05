// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	archivezip "archive/zip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupArchiveWorkspace(t *testing.T) (root, boxID string) {
	t.Helper()
	root, boxID = t.TempDir(), ast.NewNodeID()
	oldWorkspace, oldData, oldHistory := util.WorkspaceDir, util.DataDir, util.HistoryDir
	util.WorkspaceDir, util.DataDir, util.HistoryDir = root, filepath.Join(root, "data"), filepath.Join(root, "history")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir, util.HistoryDir = oldWorkspace, oldData, oldHistory })
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	if !model.IsEncryptedBox(boxID) || model.IsBoxUnlocked(boxID) {
		t.Fatal("fixture is not a locked encrypted notebook")
	}
	return
}

func writeArchiveFixture(t *testing.T, path string, names ...string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := archivezip.NewWriter(file)
	for _, name := range names {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if strings.HasSuffix(name, "/") {
			continue
		}
		if _, err = entry.Write([]byte("archive contents")); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func callArchiveAPI(t *testing.T, handler gin.HandlerFunc, body string) *gulu.Result {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/archive", handler)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/archive", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	var result gulu.Result
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid response %s: %v", recorder.Body.String(), err)
	}
	return &result
}

func TestUnzipRejectsEncryptedDescendantBeforeAnyWrite(t *testing.T) {
	root, boxID := setupArchiveWorkspace(t)
	writeArchiveFixture(t, filepath.Join(root, "payload.zip"), "allowed.txt", boxID+"/assets/payload.txt")
	result := callArchiveAPI(t, unzip, `{"zipPath":"payload.zip","path":"data"}`)
	if result.Code == 0 {
		t.Fatal("archive API accepted encrypted descendant")
	}
	for _, path := range []string{filepath.Join(util.DataDir, "allowed.txt"), filepath.Join(util.DataDir, boxID, "assets", "payload.txt")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("rejected archive modified %s: %v", path, err)
		}
	}
}

func TestZipRejectsEncryptedDescendant(t *testing.T) {
	root, _ := setupArchiveWorkspace(t)
	result := callArchiveAPI(t, zip, `{"zipPath":"result.zip","path":"data"}`)
	if result.Code == 0 {
		t.Fatal("archive API packaged ancestor of encrypted notebook")
	}
	if _, err := os.Stat(filepath.Join(root, "result.zip")); !os.IsNotExist(err) {
		t.Fatalf("rejected zip created output: %v", err)
	}
}

func TestZipRejectsEncryptedDescendantThroughRootSymlink(t *testing.T) {
	root, _ := setupArchiveWorkspace(t)
	createArchiveDirectoryLink(t, filepath.Join(root, "alias"), util.DataDir)
	result := callArchiveAPI(t, zip, `{"zipPath":"result.zip","path":"alias"}`)
	if result.Code == 0 {
		t.Fatal("archive API packaged encrypted descendant through root symlink")
	}
	if _, err := os.Stat(filepath.Join(root, "result.zip")); !os.IsNotExist(err) {
		t.Fatalf("rejected zip created output: %v", err)
	}
}

func TestUnzipWorkspaceArchiveValidatesAllEntryPaths(t *testing.T) {
	root, _ := setupArchiveWorkspace(t)
	for _, name := range []string{"../outside.txt", `..\outside.txt`, "/absolute.txt", "C:/absolute.txt"} {
		t.Run(name, func(t *testing.T) {
			if strings.HasPrefix(name, "C:") && filepath.VolumeName(name) == "" {
				t.Skip("drive paths are local filenames on this platform")
			}
			zipPath := filepath.Join(root, "payload.zip")
			writeArchiveFixture(t, zipPath, "allowed.txt", name)
			destination := filepath.Join(root, "extract")
			if err := unzipWorkspaceArchive(zipPath, destination); err == nil {
				t.Fatal("archive accepted escaping path")
			}
			if _, err := os.Stat(filepath.Join(destination, "allowed.txt")); !os.IsNotExist(err) {
				t.Fatalf("archive wrote entry before path validation: %v", err)
			}
		})
	}
}

func TestUnzipRejectsSymlinkDestination(t *testing.T) {
	root, boxID := setupArchiveWorkspace(t)
	destination := filepath.Join(root, "extract")
	if err := os.MkdirAll(destination, 0755); err != nil {
		t.Fatal(err)
	}
	createArchiveDirectoryLink(t, filepath.Join(destination, "alias"), filepath.Join(util.DataDir, boxID))
	zipPath := filepath.Join(root, "payload.zip")
	writeArchiveFixture(t, zipPath, "allowed.txt", "alias/assets/payload.txt")
	if err := unzipWorkspaceArchive(zipPath, destination); err == nil {
		t.Fatal("archive accepted encrypted symlink destination")
	}
	if _, err := os.Stat(filepath.Join(destination, "allowed.txt")); !os.IsNotExist(err) {
		t.Fatalf("archive wrote entry before symlink validation: %v", err)
	}
}

func createArchiveDirectoryLink(t *testing.T, link, target string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS != "windows" {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if output, junctionErr := exec.Command("cmd", "/d", "/c", "mklink", "/J", link, target).CombinedOutput(); junctionErr != nil {
			t.Skipf("directory links unavailable: %v %s", junctionErr, output)
		}
	}
	t.Cleanup(func() {
		if err := os.Remove(link); err != nil {
			t.Errorf("remove directory link: %v", err)
		}
	})
}

func TestUnzipWorkspaceArchiveNormalFiles(t *testing.T) {
	root, _ := setupArchiveWorkspace(t)
	zipPath := filepath.Join(root, "payload.zip")
	writeArchiveFixture(t, zipPath, "nested/file.txt", "empty/")
	destination := filepath.Join(root, "extract")
	if err := unzipWorkspaceArchive(zipPath, destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "nested", "file.txt"))
	if err != nil || string(data) != "archive contents" {
		t.Fatalf("normal extraction failed: %q %v", data, err)
	}
	if info, err := os.Stat(filepath.Join(destination, "empty")); err != nil || !info.IsDir() {
		t.Fatalf("directory entry was not extracted: %v", err)
	}
}
