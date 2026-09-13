package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIContractPetalConversion(t *testing.T) {
	for _, value := range []*model.Petal{nil, {}, {Name: "plugin", Enabled: true, I18n: map[string]any{"nested": map[string]any{"label": "text"}, "array": []any{true, nil, 1.5}}, Kernel: model.KernelPetal{JS: "code", Existed: true}}} {
		result, err := petalContract(value)
		if err != nil {
			t.Fatal(err)
		}
		before, _ := json.Marshal(value)
		after, err := json.Marshal(result)
		if err != nil || string(before) != string(after) {
			t.Fatalf("plugin payload changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractPetalInvalidRequests(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/petal/loadPetals", loadPetals)
	engine.POST("/api/petal/setPetalEnabled", setPetalEnabled)
	engine.POST("/api/petal/setPetalPublishEnabled", setPetalPublishEnabled)
	for _, path := range []string{"/api/petal/loadPetals", "/api/petal/setPetalEnabled", "/api/petal/setPetalPublishEnabled"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("missing required field accepted: %s", recorder.Body.String())
		}
	}
}
