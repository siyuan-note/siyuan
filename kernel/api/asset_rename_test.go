package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestRenameAssetMissingSourceContract(t *testing.T) {
	setupAssetContractWorkspace(t)
	model.Conf.FileTree = conf.NewFileTree()
	engine := gin.New()
	engine.POST("/api/asset/renameAsset", renameAsset)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/renameAsset",
		strings.NewReader(`{"oldPath":"assets/missing-20261009000001-abcdefg.pdf?page=2#x","newName":"renamed"}`)))
	requireAPIContract(t, "POST", "/api/asset/renameAsset", recorder)
	var response struct {
		Code int
		Msg  string
		Data struct {
			CloseTimeout int    `json:"closeTimeout"`
			NewPath      string `json:"newPath"`
		}
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != -1 || response.Msg == "" || response.Data.CloseTimeout != 5000 || response.Data.NewPath != "" {
		t.Fatalf("missing source reported success or omitted error prompt: %s", recorder.Body.String())
	}
}
