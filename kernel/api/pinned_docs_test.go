package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPinnedDocs(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/filetree/getPinnedDocs", getPinnedDocs)
	engine.POST("/api/filetree/updatePinnedDocs", updatePinnedDocs)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/filetree/getPinnedDocs", nil))
	requireAPIContract(t, http.MethodPost, "/api/filetree/getPinnedDocs", response)
	if !strings.Contains(response.Body.String(), `"data":[]`) {
		t.Fatal(response.Body.String())
	}
	for _, body := range []string{`{}`, `{"ids":[],"action":"pin"}`, `{"ids":[null],"action":"pin"}`, `{"ids":["invalid"],"action":"pin"}`} {
		response = httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/filetree/updatePinnedDocs", strings.NewReader(body)))
		requireAPIContract(t, http.MethodPost, "/api/filetree/updatePinnedDocs", response)
		if !strings.Contains(response.Body.String(), `"code":-1`) {
			t.Fatal(response.Body.String())
		}
	}
}
