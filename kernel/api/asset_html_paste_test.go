package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractHTMLLocalAssets(t *testing.T) {
	previousConf, previousWorkspace, previousData, previousHome := model.Conf, util.WorkspaceDir, util.DataDir, util.HomeDir
	util.WorkspaceDir, util.HomeDir = t.TempDir(), t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	boxID := "20261002120000-htmlenc"
	t.Cleanup(func() {
		model.Conf, util.WorkspaceDir, util.DataDir, util.HomeDir = previousConf, previousWorkspace, previousData, previousHome
	})
	write := func(name string, data []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxData, _ := json.Marshal(boxConf)
	write(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), boxData)
	source := filepath.Join(t.TempDir(), "image space.png")
	content := []byte("HTML paste temporary image")
	write(source, content)
	write(filepath.Join(util.DataDir, "assets", "image space.png"), content)
	hash, err := util.GetEtagByHandle(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	cache.SetAssetHash(hash, "assets/image space.png")
	t.Cleanup(func() { cache.RemoveAssetHash(hash) })
	fileURL := (&url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(filepath.ToSlash(source), "/")}).String()
	paths := []string{fileURL, filepath.Join(util.HomeDir, ".ssh", "private.png"),
		filepath.Join(util.WorkspaceDir, "conf", "private.png"), filepath.Join(util.WorkspaceDir, "temp", "decrypted.png"),
		filepath.Join(util.DataDir, boxID, "assets", "encrypted.png"), filepath.Join(t.TempDir(), "missing.png"), fileURL}
	for _, p := range paths[1:5] {
		write(p, []byte("protected original"))
	}
	body, _ := json.Marshal(apicontract.InsertLocalAssetsRequest{AssetPaths: paths, FromHTMLPaste: true})
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/asset/insertLocalAssets", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")
	insertLocalAssets(context)
	requireAPIContract(t, http.MethodPost, "/api/asset/insertLocalAssets", recorder)
	var response struct {
		Code int                         `json:"code"`
		Data apicontract.AssetUploadData `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != -1 || len(response.Data.SuccFiles) != 2 || len(response.Data.FailedFiles) != 5 {
		t.Fatalf("unexpected partial response: %s", recorder.Body.String())
	}
	for i, index := range []int{0, 6} {
		if response.Data.SuccFiles[i].Index != index || response.Data.SuccFiles[i].Path != "assets/image space.png" {
			t.Fatalf("successful input mapping changed: %+v", response.Data.SuccFiles)
		}
	}
	for i, failure := range response.Data.FailedFiles {
		if failure.Index != i+1 {
			t.Fatalf("failed input mapping changed: %+v", response.Data.FailedFiles)
		}
		if i < 4 && failure.Error != "local asset path is not allowed" {
			t.Errorf("protected file was not rejected: %+v", failure)
		}
	}
	for _, p := range paths[1:5] {
		data, err := os.ReadFile(p)
		if err != nil || string(data) != "protected original" {
			t.Errorf("protected source changed: %s (%v)", p, err)
		}
	}
}
