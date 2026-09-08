package model

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestResolveAIProviderHeaders(t *testing.T) {
	previousConf := Conf
	t.Cleanup(func() { Conf = previousConf })
	Conf = &AppConf{
		Secrets:   &conf.Secrets{Items: []*conf.Secret{{Name: "TOKEN", Value: "private-token", AllowedHosts: []string{"127.0.0.1"}}}},
		Variables: &conf.Variables{Items: []*conf.Variable{{Name: "ROUTE", Value: "route-a"}}},
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer private-token" || r.Header.Get("X-Route") != "route-a" {
			t.Error("resolved provider headers did not reach upstream")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"data":[]}`)
	}))
	defer server.Close()
	provider := &conf.Provider{BaseURL: server.URL + "/v1", Headers: map[string]string{
		"Authorization": "Bearer {{secrets.TOKEN}}", "X-Route": "{{vars.ROUTE}}",
	}}
	client := util.NewOpenAIClient("", provider.BaseURL, ResolveAIProviderHeaders(provider))
	if _, err := client.ListModels(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || provider.Headers["Authorization"] != "Bearer {{secrets.TOKEN}}" {
		t.Fatal("request missing or stored reference overwritten")
	}
	for _, baseURL := range []string{"https://other.example.com/v1", "https://127.0.0.1.example.com/v1"} {
		provider.BaseURL = baseURL
		if strings.Contains(ResolveAIProviderHeaders(provider)["Authorization"], "private-token") {
			t.Fatal("secret resolved for unauthorized host")
		}
	}
	provider.BaseURL = server.URL + "/v1"
	endpoint, _ := url.Parse(server.URL)
	Conf.Secrets.Items[0].AllowedHosts = []string{endpoint.Hostname()}
	Conf.Secrets.Items[0].Value = "private-token\r\ninjected: true"
	client = util.NewOpenAIClient("", provider.BaseURL, ResolveAIProviderHeaders(provider))
	if _, err := client.ListModels(context.Background()); err == nil || strings.Contains(err.Error(), "private-token") {
		t.Fatal("invalid resolved header must fail without exposing its value")
	}
	if requests != 1 {
		t.Fatal("invalid resolved header reached upstream")
	}
}
