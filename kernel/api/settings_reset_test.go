package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
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
