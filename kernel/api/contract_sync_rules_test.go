package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractSyncProviderConfigRules(t *testing.T) {
	syncTestConfiguration(t)
	before := syncMarshal(t, model.Conf.Sync.Load())
	engine := gin.New()
	const path = "/api/sync/getSyncProviderConfigRules"
	engine.POST(path, getSyncProviderConfigRules)
	for _, tc := range []struct {
		body           string
		provider, code int
		warning        bool
	}{
		{`{"provider":2,"endpoint":"https://notes.example.com","bucket":"notes"}`, conf.ProviderS3, 0, true},
		{`{"provider":2}`, conf.ProviderS3, 0, false},
		{`{"provider":3,"endpoint":"https://notes.example.com","bucket":"notes"}`, conf.ProviderWebDAV, 0, false},
		{`{"provider":4}`, conf.ProviderLocal, 0, false},
		{`{"provider":0}`, 0, -1, false},
		{`{"provider":99}`, 99, -1, false},
		{`{"provider":"2"}`, 0, -1, false},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(tc.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int                                     `json:"code"`
			Data apicontract.SyncProviderConfigRulesData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != tc.code {
			t.Fatalf("unexpected response: %s (%v)", recorder.Body.String(), err)
		}
		if tc.code == 0 && (!reflect.DeepEqual(response.Data.RequiredFields, conf.SyncProviderRequiredFields(tc.provider)) || response.Data.EndpointBucketWarning != tc.warning) {
			t.Fatalf("rules differ from kernel validation: %s", recorder.Body.String())
		}
	}
	if string(before) != string(syncMarshal(t, model.Conf.Sync.Load())) {
		t.Fatal("rule requests changed the saved configuration")
	}
}
