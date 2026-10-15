package api

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSyncClearConfiguration(t *testing.T) {
	syncTestConfiguration(t)
	previousDir, previousRepo, previousData := util.ConfDir, util.RepoDir, util.DataDir
	t.Cleanup(func() { util.ConfDir, util.RepoDir, util.DataDir = previousDir, previousRepo, previousData })
	util.ConfDir = t.TempDir()
	util.RepoDir, util.DataDir = filepath.Join(util.ConfDir, "repo"), filepath.Join(util.ConfDir, "data")
	util.ReadOnly = false
	engine := gin.New()
	const path = "/api/sync/clearSyncProviderConfig"
	engine.POST(path, clearSyncProviderConfig)
	for _, body := range []string{`{}`, `{"provider":null}`, `{"provider":"2"}`, `{"provider":2.5}`, `{"provider":0}`, `{"provider":5}`, `{"provider":2}`} {
		model.Conf.Sync.Load().Provider, model.Conf.Sync.Load().Enabled = conf.ProviderS3, true
		model.Conf.Sync.Load().S3 = &conf.S3{Endpoint: "https://s3.example", SecretKey: "secret"}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int                                      `json:"code"`
			Data *apicontract.ClearSyncProviderConfigData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if body == `{"provider":2}` {
			if response.Code != 0 || response.Data == nil || response.Data.Enabled || response.Data.S3 == nil || response.Data.S3.SecretKey != "" {
				t.Fatalf("clear response: %s", recorder.Body.String())
			}
		} else if response.Code == 0 || model.Conf.Sync.Load().S3.SecretKey != "secret" || !model.Conf.Sync.Load().Enabled {
			t.Fatalf("invalid clear changed configuration: %s", recorder.Body.String())
		}
	}
}
