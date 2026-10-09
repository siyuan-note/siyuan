package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingsResetInput(t *testing.T) {
	for _, body := range []string{`{}`, `{"exit":true}`, `{"exit":false}`} {
		if _, err := apicontract.ResetSettings.Decode(strings.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := apicontract.ResetSettings.Decode(strings.NewReader(`{"exit":"yes"}`)); err == nil {
		t.Fatal("invalid exit accepted")
	}
	for _, body := range []string{`{}`, `{"token":"x"}`, `{"token":"x","saved":"yes"}`} {
		if _, err := apicontract.ConfirmSettingsReset.Decode(strings.NewReader(body)); err == nil {
			t.Fatal("invalid acknowledgement accepted")
		}
	}
	code, _, _ := settingContractRequest(t, "confirmSettingsReset", confirmSettingsReset, `{"token":"unknown","saved":true}`)
	if code == 0 {
		t.Fatal("unknown reset token accepted")
	}
}

func TestAPIContractSettingsResetPreparation(t *testing.T) {
	for _, success := range []bool{false, true} {
		waiter := &settingsResetWaiter{pending: map[string]bool{"a": true, "b": true}, results: make(chan bool, 2)}
		waiter.results <- true
		waiter.results <- success
		if err := waiter.wait(context.Background()); (err == nil) != success {
			t.Fatalf("unexpected preparation result: %v", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	waiter := &settingsResetWaiter{pending: map[string]bool{"a": true}, results: make(chan bool, 1)}
	if waiter.wait(ctx) == nil {
		t.Fatal("cancelled reset continued")
	}
}

func TestAPIContractSettingsResetTokenUsedOnce(t *testing.T) {
	waiter := &settingsResetWaiter{pending: map[string]bool{"one-use": true}, results: make(chan bool, 1)}
	settingsResetPreparation.Lock()
	settingsResetPreparation.waiter = waiter
	settingsResetPreparation.Unlock()
	t.Cleanup(func() {
		settingsResetPreparation.Lock()
		settingsResetPreparation.waiter = nil
		settingsResetPreparation.Unlock()
	})
	for _, expected := range []int{0, -1} {
		code, _, _ := settingContractRequest(t, "confirmSettingsReset", confirmSettingsReset, `{"token":"one-use","saved":true}`)
		if code != expected {
			t.Fatalf("unexpected acknowledgement result: %d", code)
		}
	}
	if err := waiter.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestAPIContractSettingsResetAuthorization(t *testing.T) {
	previousReadonly, previousConf := util.ReadOnly, model.Conf
	model.Conf = &model.AppConf{Lang: "en"}
	t.Cleanup(func() { util.ReadOnly, model.Conf = previousReadonly, previousConf })
	gin.SetMode(gin.TestMode)
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
		util.ReadOnly = role == model.RoleAdministrator
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		for _, endpoint := range []string{"resetSettings", "confirmSettingsReset"} {
			path := "/api/setting/" + endpoint
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`)))
			if role != model.RoleAdministrator {
				if recorder.Code != http.StatusForbidden {
					t.Fatalf("role %v admitted by %s", role, endpoint)
				}
			} else {
				if strings.Contains(recorder.Body.String(), `"code":0`) {
					t.Fatalf("readonly administrator admitted by %s", endpoint)
				}
				requireAPIContract(t, http.MethodPost, path, recorder)
			}
		}
	}
}

func TestAPIContractSettingsResetSerializesGraphWrites(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	model.Conf, util.ReadOnly = model.NewAppConf(), true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	gin.SetMode(gin.TestMode)
	for _, entry := range []struct {
		path    string
		handler gin.HandlerFunc
		body    string
		changed bool
	}{
		{"/api/graph/setGraphConf", setGraphConf, `{"type":"global","conf":{"minRefs":20}}`, true},
		{"/api/graph/setGraphConf", setGraphConf, `{"type":"local","conf":{"dailyNote":false}}`, true},
		{"/api/graph/resetGraph", resetGraph, `{}`, true},
		{"/api/graph/resetLocalGraph", resetLocalGraph, `{}`, true},
		{"/api/graph/getGraph", getGraph, `{"conf":{"d3":false}}`, false},
		{"/api/graph/getLocalGraph", getLocalGraph, `{"id":"missing","conf":{"d3":false}}`, false},
	} {
		t.Run(entry.path+entry.body, func(t *testing.T) {
			model.Conf.Graph = conf.NewGraph()
			model.Conf.Graph.Global.MinRefs = 7
			model.Conf.Graph.Local.DailyNote = true
			before := string(graphJSON(t, model.Conf.Graph))
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set(model.RoleContextKey, model.RoleAdministrator)
			c.Request = httptest.NewRequest(http.MethodPost, entry.path, strings.NewReader(entry.body))
			started, finished := make(chan struct{}), make(chan struct{})
			settingMutationMu.Lock()
			go func() {
				close(started)
				entry.handler(c)
				close(finished)
			}()
			<-started
			select {
			case <-finished:
				t.Error("graph write bypassed the settings reset lock")
			case <-time.After(50 * time.Millisecond):
			}
			settingMutationMu.Unlock()
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("graph write did not resume after settings reset unlocked")
			}
			requireAPIContract(t, http.MethodPost, entry.path, recorder)
			if changed := before != string(graphJSON(t, model.Conf.Graph)); changed != entry.changed {
				t.Fatal("graph write or validation changed after unlocking")
			}
		})
	}
}
