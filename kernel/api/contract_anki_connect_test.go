package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnkiConnectContractAuthenticationAndVersions(t *testing.T) {
	previous := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Flashcard, model.Conf.Api = conf.NewFlashcard(), conf.NewAPI()
	model.Conf.Api.Token = "anki-connect-test-token"
	model.Conf.AccessAuthCode = "access-code"
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.POST("/api/flashcard/ankiConnect", ankiConnect)
	for _, test := range []struct {
		name, body, remote, host, origin, forwarded, fetch, authorization string
		enabled, local, success                                           bool
		want                                                              string
	}{
		{name: "disabled", body: `{"action":"version","version":6,"key":"anki-connect-test-token"}`},
		{name: "token", body: `{"action":"version","version":6,"key":"anki-connect-test-token"}`, enabled: true, success: true, want: `{"result":6,"error":null}`},
		{name: "header", body: `{"action":"version","version":5}`, authorization: "Token anki-connect-test-token", enabled: true, success: true, want: `{"result":6,"error":null}`},
		{name: "legacy", body: `{"action":"version","key":"anki-connect-test-token"}`, enabled: true, success: true, want: `6`},
		{name: "missing-key", body: `{"action":"version","version":6}`, enabled: true},
		{name: "local-opt-in", body: `{"action":"version","version":6}`, remote: "127.0.0.1:12345", host: "127.0.0.1:6806", enabled: true, local: true, success: true, want: `{"result":6,"error":null}`},
		{name: "remote", body: `{"action":"version","version":6}`, remote: "192.0.2.4:12345", host: "127.0.0.1:6806", enabled: true, local: true},
		{name: "rebind", body: `{"action":"version","version":6}`, remote: "127.0.0.1:12345", host: "evil.example", enabled: true, local: true},
		{name: "origin", body: `{"action":"version","version":6}`, remote: "127.0.0.1:12345", host: "127.0.0.1:6806", origin: "http://evil.example", enabled: true, local: true},
		{name: "forwarded-host", body: `{"action":"version","version":6}`, remote: "127.0.0.1:12345", host: "127.0.0.1:6806", forwarded: "evil.example", enabled: true, local: true},
		{name: "cross-site", body: `{"action":"version","version":6}`, remote: "127.0.0.1:12345", host: "127.0.0.1:6806", fetch: "cross-site", enabled: true, local: true},
		{name: "bad-key-local", body: `{"action":"version","version":6,"key":"bad"}`, remote: "127.0.0.1:12345", host: "127.0.0.1:6806", enabled: true, local: true},
		{name: "bad-version", body: `{"action":"version","version":7,"key":"anki-connect-test-token"}`, enabled: true},
		{name: "malformed", body: `{"action":"version","version":"6"}`, enabled: true},
		{name: "reflect-empty", body: `{"action":"apiReflect","version":6,"key":"anki-connect-test-token","params":{"scopes":[]}}`, enabled: true, success: true, want: `{"result":{"scopes":[]},"error":null}`},
		{name: "reflect-actions", body: `{"action":"apiReflect","version":6,"key":"anki-connect-test-token","params":{"scopes":["actions"],"actions":["version","unknown"]}}`, enabled: true, success: true, want: `{"result":{"scopes":["actions"],"actions":["version"]},"error":null}`},
		{name: "mixed-notes", body: `{"action":"addNotes","params":{"notes":[1,{}]}}`, enabled: true},
		{name: "multi", body: `{"action":"multi","version":6,"key":"anki-connect-test-token","params":{"actions":[{"action":"version","version":6},{"action":"version","version":4},{"action":"unknown","version":6}]}}`, enabled: true, success: true, want: `{"result":[{"result":6,"error":null},6,{"result":null,"error":"unsupported action"}],"error":null}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			model.Conf.Flashcard.AnkiConnectEnabled, model.Conf.Flashcard.AnkiConnectLocalWithoutKey = test.enabled, test.local
			request := httptest.NewRequest("POST", "http://127.0.0.1:6806/api/flashcard/ankiConnect", strings.NewReader(test.body))
			if test.remote != "" {
				request.RemoteAddr = test.remote
			}
			if test.host != "" {
				request.Host = test.host
			}
			request.Header.Set("Origin", test.origin)
			request.Header.Set("X-Forwarded-Host", test.forwarded)
			request.Header.Set("Sec-Fetch-Site", test.fetch)
			request.Header.Set("Authorization", test.authorization)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/flashcard/ankiConnect", recorder)
			if test.success {
				if recorder.Body.String() != test.want {
					t.Fatalf("unexpected protocol response: %s", recorder.Body.String())
				}
			} else {
				var failure struct {
					Result json.RawMessage
					Error  string
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &failure); err != nil || failure.Error == "" || string(failure.Result) != "null" {
					t.Fatalf("expected protocol error: %s %v", recorder.Body.String(), err)
				}
			}
		})
	}
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	util.ReadOnly = true
	model.Conf.Flashcard.AnkiConnectEnabled = true
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "http://127.0.0.1:6806/api/flashcard/ankiConnect?token=anki-connect-test-token",
		strings.NewReader(`{"action":"createDeck","version":6,"params":{"deck":"Words"}}`)))
	requireAPIContract(t, "POST", "/api/flashcard/ankiConnect", recorder)
	if !strings.Contains(recorder.Body.String(), "SiYuan is read-only") {
		t.Fatalf("write bypassed read-only: %s", recorder.Body.String())
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse("POST", "/api/flashcard/ankiConnect", []byte(`{"arbitrary":"JSON"}`)); err == nil {
		t.Fatal("response contract accepts an undeclared result shape")
	}
}
