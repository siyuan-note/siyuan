package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestAPIContractPluginPrivateServiceAdmission(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Any("/plugin/private/:name/*path", pluginPrivateWebServer)
	server := httptest.NewServer(engine)
	defer server.Close()
	for _, method := range []string{"GET", "POST", "HEAD", "PATCH", "DELETE", "OPTIONS", "PUT", "CONNECT", "TRACE"} {
		request, _ := http.NewRequest(method, server.URL+"/plugin/private/contract-missing/value", strings.NewReader("raw non-JSON"))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatalf("admission changed: %d %s", response.StatusCode, payload)
		}
		if err = bundle.ValidatePluginServiceResponse(method, "/plugin/private/:name/*path", apicontract.PluginServiceAdmission, response.StatusCode, response.Header.Get("Content-Type"), payload); err != nil {
			t.Fatal(err)
		}
		if method != "HEAD" && string(payload) != "[plugin:contract-missing] not found" {
			t.Fatalf("admission message changed: %s", payload)
		}
	}
}
