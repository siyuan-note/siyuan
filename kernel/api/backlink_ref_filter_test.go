package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestParseBacklinkRefFilter(t *testing.T) {
	const id = "20260909160000-archive"
	filter := parseBacklinkSourceFilter(map[string]any{"sourceFilter": map[string]any{
		"excludedRefDefIDs": []any{id, "", 12, "invalid", id},
	}})
	if nil == filter || len(filter.ExcludedRefDefIDs) != 1 || filter.ExcludedRefDefIDs[0] != id {
		t.Fatalf("unexpected filter: %+v", filter)
	}
	if nil != parseBacklinkSourceFilter(map[string]any{"sourceFilter": map[string]any{}}) {
		t.Fatal("empty filters must preserve default behavior")
	}
}

func TestPublishReaderBacklinkRefCandidates(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() { model.Conf = oldConf })
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/ref/getBacklink2", getBacklink2)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/ref/getBacklink2", strings.NewReader(
		`{"id":"20260909160000-archive","k":"","mk":"","refDefCandidates":true,"sourceFilter":{"excludedRefDefIDs":["20260909160001-private"]}}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	var response struct {
		Code int `json:"code"`
		Data struct {
			RefDefs []any `json:"refDefs"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); nil != err {
		t.Fatal(err)
	}
	if response.Code != 0 || nil == response.Data.RefDefs || len(response.Data.RefDefs) != 0 {
		t.Fatalf("published view exposed reference candidates: %s", recorder.Body.String())
	}
}
