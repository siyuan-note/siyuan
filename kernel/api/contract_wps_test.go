package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractWPSFailurePayload(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/lute/wpsPresentation2BlockDOM", wpsPresentation2BlockDOM)
	for _, body := range []string{"{", `{}`, `{"data":null,"type":"objects"}`, `{"data":"x","text":42,"type":"objects"}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/lute/wpsPresentation2BlockDOM", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/lute/wpsPresentation2BlockDOM", recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) || !strings.Contains(recorder.Body.String(), `"data":{"converted":false,"dom":""}`) {
			t.Fatalf("WPS failure payload changed: %s", recorder.Body.String())
		}
	}
}
