package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractFormatInputCompatibility(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `[]`, `{`, `{"id":null}`, `{"id":3}`, `{"id":"  abc  "}`, `{"id":""}`, `{"id":"abc","url":null}`, `{"id":"abc","url":3}`, `{"id":"abc","url":"  https://example.com/a  "}`} {
		t.Run(body, func(t *testing.T) {
			legacy := gulu.Ret.NewResult()
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest("POST", "/api/format/netImg2LocalAssets", strings.NewReader(body))
			args, ok := util.JsonArg(context, legacy)
			var id, url string
			if ok {
				ok = util.ParseJsonArgs(args, legacy, util.BindJsonArg("id", &id, true, true), util.BindJsonArg("url", &url, false, false))
			}
			request, err := apicontract.NetImg2LocalAssets.Decode(strings.NewReader(body))
			if ok != (err == nil) {
				t.Fatalf("acceptance mismatch: legacy=%v, contract=%v", ok, err)
			}
			if ok && (request.ID != id || request.URL != url) {
				t.Fatalf("request mismatch: %#v, id=%q url=%q", request, id, url)
			}
		})
	}
}

func TestAPIContractFormatInvalidResponses(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/format/autoSpace", autoSpace)
	engine.POST("/api/format/netAssets2LocalAssets", netAssets2LocalAssets)
	engine.POST("/api/format/netImg2LocalAssets", netImg2LocalAssets)
	for _, path := range []string{"/api/format/autoSpace", "/api/format/netAssets2LocalAssets", "/api/format/netImg2LocalAssets"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{"id":3}`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("expected invalid ID failure: %s", recorder.Body.String())
		}
	}
}
