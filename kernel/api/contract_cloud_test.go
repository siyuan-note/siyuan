package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIContractCloudPayloads(t *testing.T) {
	for _, value := range []*model.Sync{nil, {}, {Size: 12345, HSize: "12 KB", Updated: "date", CloudName: "cloud", SaveDir: "local"}} {
		before, _ := json.Marshal(value)
		after, err := json.Marshal(cloudSyncContract(value))
		if err != nil || string(before) != string(after) {
			t.Fatalf("sync payload changed: %s != %s, %v", before, after, err)
		}
	}
	for _, value := range []*model.Backup{nil, {}, {Size: 12345, HSize: "12 KB", Updated: "date", SaveDir: "local"}} {
		before, _ := json.Marshal(value)
		after, err := json.Marshal(cloudBackupContract(value))
		if err != nil || string(before) != string(after) {
			t.Fatalf("backup payload changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractCloudReminderArguments(t *testing.T) {
	request, err := apicontract.SetCloudReminder.Decode(strings.NewReader(`{"id":" id ","timed":" time ","content":" content "}`))
	if err != nil || request.ID != " id " || request.Timed != " time " || request.Content != " content " {
		t.Fatalf("reminder arguments changed: %#v, %v", request, err)
	}
	engine := gin.New()
	engine.POST("/api/cloud/setCloudReminder", setCloudReminder)
	for _, body := range []string{`{}`, `{"id":"id","timed":"0","content":null}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/cloud/setCloudReminder", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/cloud/setCloudReminder", recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("invalid reminder accepted: %s", recorder.Body.String())
		}
	}
}
