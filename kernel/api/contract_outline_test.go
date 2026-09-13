package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractOutlineEmptyInputs(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/outline/getDocOutline", getDocOutline)
	engine.POST("/api/outline/getDocHeadingNumbers", getDocHeadingNumbers)
	for _, path := range []string{"/api/outline/getDocOutline", "/api/outline/getDocHeadingNumbers"} {
		for _, body := range []string{`{}`, `{"id":null,"preview":42,"notebook":42}`} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
			requireAPIContract(t, "POST", path, recorder)
			if !strings.Contains(recorder.Body.String(), `"code":0`) {
				t.Fatalf("missing ID must retain empty success: %s %s: %s", path, body, recorder.Body.String())
			}
		}
	}
}
