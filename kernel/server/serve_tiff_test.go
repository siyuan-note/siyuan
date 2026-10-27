// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/tiffpreview"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/image/tiff"
)

func tiffSource(t *testing.T) []byte {
	t.Helper()
	img := image.NewGray16(image.Rect(0, 0, 3, 1))
	for x, value := range []uint16{120, 1960, 3800} {
		img.SetGray16(x, 0, color.Gray16{Y: value})
	}
	var buffer bytes.Buffer
	if err := tiff.Encode(&buffer, img, &tiff.Options{Compression: tiff.Deflate}); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func tiffTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	originalData, originalTemp, originalHistory, originalConf := util.DataDir, util.TempDir, util.HistoryDir, model.Conf
	originalWorkspace := util.WorkspaceDir
	originalRepo, originalConfDir := util.RepoDir, util.ConfDir
	root := filepath.Join(t.TempDir(), "notes#1")
	util.WorkspaceDir = root
	util.DataDir, util.TempDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "history")
	util.RepoDir, util.ConfDir = filepath.Join(root, "repo"), filepath.Join(root, "conf")
	model.Conf = model.NewAppConf()
	t.Cleanup(func() {
		util.DataDir, util.TempDir, util.HistoryDir, model.Conf = originalData, originalTemp, originalHistory, originalConf
		util.WorkspaceDir = originalWorkspace
		util.RepoDir, util.ConfDir = originalRepo, originalConfDir
	})
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveAssets(engine)
	serveRepoDiff(engine)
	return engine
}

// openTIFFSnapshots 从真实仓库文件元数据走快照预览生产链路，不预先构造临时预览文件。
func openTIFFSnapshots(t *testing.T, paths ...string) map[string]string {
	t.Helper()
	model.Conf.Repo.Store(conf.NewRepo())
	model.Conf.Repo.Load().Key = []byte("0123456789abcdef0123456789abcdef")
	if model.Conf.System.Load() == nil {
		model.Conf.System.Store(conf.NewSystem())
	}
	if model.Conf.Sync.Load() == nil {
		model.Conf.Sync.Store(conf.NewSync())
	}
	model.Conf.Sync.Load().Provider = conf.ProviderLocal
	model.Conf.Sync.Load().Local = &conf.Local{Endpoint: filepath.Join(util.WorkspaceDir, "cloud")}
	model.Conf.Sync.Load().CloudName = "tiff-test"
	util.RepoDir = filepath.Join(util.WorkspaceDir, "repo")
	for _, directory := range []string{util.ConfDir, util.TempDir, util.HistoryDir} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir,
		"tiff-test", "tiff-test", "windows", model.Conf.Repo.Load().Key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("TIFF preview", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	if err = repo.GetFilesIter(index, func(file *entity.File) error {
		files[strings.TrimPrefix(file.Path, "/")] = file.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	previews := map[string]string{}
	for _, path := range paths {
		id := files[path]
		if id == "" {
			t.Fatalf("TIFF missing from snapshot: %s", path)
		}
		_, content, _, _, err := model.OpenRepoSnapshotFile(id)
		if err != nil {
			t.Fatal(err)
		}
		if content != "repo/diff/"+path {
			t.Fatalf("TIFF snapshot preview missing: %q", content)
		}
		previews[path] = "/" + content
	}
	return previews
}

func TestServeTIFFRealRepoSnapshots(t *testing.T) {
	engine := tiffTestEngine(t)
	source := tiffSource(t)
	paths := []string{"assets/image.tif", "assets/image.TIFF"}
	for _, path := range paths {
		writeTIFFTestFile(t, filepath.Join(util.DataDir, filepath.FromSlash(path)), source)
	}
	previews := openTIFFSnapshots(t, paths...)
	for _, path := range paths {
		staged, err := os.ReadFile(filepath.Join(util.TempDir, "repo", "diff", filepath.FromSlash(path)))
		if err != nil || !bytes.Equal(staged, source) {
			t.Fatalf("snapshot preview source was not staged: %v", err)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, previews[path], nil))
		assertTIFFPreview(t, recorder)
	}
}

func TestServeTIFFWorkspaceWithHash(t *testing.T) {
	engine := tiffTestEngine(t)
	if !strings.Contains(util.WorkspaceDir, "#") {
		t.Fatal("test workspace must contain a hash")
	}
	source := tiffSource(t)
	for _, test := range []struct{ url, path string }{
		{"/assets/image.tif", filepath.Join(util.DataDir, "assets", "image.tif")},
		{"/history/2026-10-21-120000-update/assets/image.tif", filepath.Join(util.HistoryDir, "2026-10-21-120000-update", "assets", "image.tif")},
		{"/repo/diff/assets/image.tif", filepath.Join(util.TempDir, "repo", "diff", "assets", "image.tif")},
	} {
		writeTIFFTestFile(t, test.path, source)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.url+"?style=thumb", nil))
		assertTIFFPreview(t, recorder)
	}
}

func writeTIFFTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func assertTIFFPreview(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("preview returned %d, %s", recorder.Code, recorder.Header().Get("Content-Type"))
	}
	img, err := png.Decode(bytes.NewReader(recorder.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds() != image.Rect(0, 0, 3, 1) {
		t.Fatalf("preview bounds = %v", img.Bounds())
	}
	if got := color.GrayModel.Convert(img.At(2, 0)).(color.Gray).Y; got != 255 {
		t.Fatalf("16-bit preview remains dark: brightest pixel = %d", got)
	}
}

func TestServeTIFFRoutesPreviewAndOriginalDownload(t *testing.T) {
	engine := tiffTestEngine(t)
	// 超过通用缩略图阈值，验证 download 与 style=thumb 同时出现时仍下载原件。
	source := append(tiffSource(t), make([]byte, 1024*1024)...)
	for _, test := range []struct{ url, path string }{
		{"/assets/image.TIF", filepath.Join(util.DataDir, "assets", "image.TIF")},
		{"/history/2026-10-21-120000-update/assets/image.tiff", filepath.Join(util.HistoryDir, "2026-10-21-120000-update", "assets", "image.tiff")},
		{"/repo/diff/assets/image.tif", filepath.Join(util.TempDir, "repo", "diff", "assets", "image.tif")},
	} {
		t.Run(test.url, func(t *testing.T) {
			writeTIFFTestFile(t, test.path, source)
			var etag string
			for _, query := range []string{"", "?style=thumb"} {
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.url+query, nil))
				assertTIFFPreview(t, recorder)
				if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Fatal("missing nosniff header")
				}
				if query == "" {
					etag = recorder.Header().Get("ETag")
				}
			}
			if etag == "" {
				t.Fatal("missing preview ETag")
			}
			request := httptest.NewRequest(http.MethodGet, test.url, nil)
			request.Header.Set("If-None-Match", etag)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotModified {
				t.Fatalf("cached preview = %d", recorder.Code)
			}
			for _, query := range []string{"?download=true", "?style=thumb&download=TRUE"} {
				recorder = httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.url+query, nil))
				if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), source) {
					t.Fatalf("original download changed: status %d", recorder.Code)
				}
			}
			preserved, err := os.ReadFile(test.path)
			if err != nil || !bytes.Equal(preserved, source) {
				t.Fatal("preview rewrote the source TIFF")
			}
		})
	}
}

func TestServeTIFFRejectsCorruptAndOversizedSources(t *testing.T) {
	engine := tiffTestEngine(t)
	path := filepath.Join(util.DataDir, "assets", "bad.tif")
	writeTIFFTestFile(t, path, []byte("corrupt TIFF"))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/bad.tif", nil))
	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("corrupt preview = %d", recorder.Code)
	}
	file, err := os.OpenFile(path, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	err = file.Truncate(tiffpreview.MaxInputBytes + 1)
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/bad.tif", nil))
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized preview = %d", recorder.Code)
	}
}

func TestServeTIFFLockedNotebook(t *testing.T) {
	engine := tiffTestEngine(t)
	const boxID = "20261021000000-tifflck"
	writeTIFFTestFile(t, filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), []byte(`{"encrypted":true}`))
	writeTIFFTestFile(t, filepath.Join(util.DataDir, boxID, "assets", "image.tif"), []byte("SYAE"))
	writeTIFFTestFile(t, filepath.Join(util.HistoryDir, "2026-10-21-120000-update", boxID, "assets", "image.tif"), []byte("SYAE"))
	writeTIFFTestFile(t, filepath.Join(util.TempDir, "repo", "diff", boxID, "assets", "image.tif"), []byte("SYAE"))
	for _, url := range []string{
		"/assets/image.tif?box=" + boxID,
		"/history/2026-10-21-120000-update/" + boxID + "/assets/image.tif",
		"/repo/diff/" + boxID + "/assets/image.tif",
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, url, nil))
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("locked notebook GET %s = %d", url, recorder.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(util.TempDir, "assets-cache", "tiff")); !os.IsNotExist(err) {
		t.Fatal("locked notebook created a preview cache")
	}
}
