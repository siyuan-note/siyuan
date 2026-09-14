package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractGetBlockInfoIDTypeMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/block/getBlockInfo", getBlockInfo)
	for _, value := range []string{`42`, `true`, `[]`, `{}`} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/block/getBlockInfo", strings.NewReader(`{"id":`+value+`}`))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		var result struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != http.StatusOK || result.Code != -1 || result.Msg != "Field [id] should be of type [String]" {
			t.Fatalf("id=%s: status=%d body=%s", value, recorder.Code, recorder.Body.String())
		}
	}
}
