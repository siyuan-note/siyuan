package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIContractPandocArguments(t *testing.T) {
	for _, body := range []string{`{"args":[]}`, `{"dir":null,"args":[]}`, `{"dir":"  dir  ","args":["--from","markdown","a b.md"]}`} {
		request, err := apicontract.Pandoc.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if len(request.Args) > 0 && (request.Dir != "  dir  " || request.Args[2] != "a b.md") {
			t.Fatalf("arguments changed: %#v", request)
		}
	}
	engine := gin.New()
	engine.POST("/api/convert/pandoc", pandoc)
	for _, body := range []string{`{}`, `{"args":null}`, `{"args":[1]}`, `{"args":[],"dir":1}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/convert/pandoc", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/convert/pandoc", recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("invalid arguments accepted: %s", recorder.Body.String())
		}
	}
}
