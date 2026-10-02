package api

import (
	archiveZip "archive/zip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractKeyboardDiagnostic(t *testing.T) {
	oldConf, oldTemp, oldHome, oldLog, oldBypass := model.Conf, util.TempDir, util.HomeDir, logging.LogPath, util.SiYuanAccessAuthCodeBypass
	oldReadonly := util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.ReadOnly = true
	util.ReadOnly = true
	util.TempDir, util.HomeDir = t.TempDir(), t.TempDir()
	logging.SetLogPath(filepath.Join(util.TempDir, "siyuan.log"))
	util.SiYuanAccessAuthCodeBypass = false
	t.Cleanup(func() {
		model.Conf, util.TempDir, util.HomeDir = oldConf, oldTemp, oldHome
		logging.SetLogPath(oldLog)
		util.SiYuanAccessAuthCodeBypass = oldBypass
		util.ReadOnly = oldReadonly
	})
	request := func(role model.Role, body string) *httptest.ResponseRecorder {
		t.Helper()
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/system/appendKeyboardLog", strings.NewReader(body)))
		if recorder.Code == http.StatusOK {
			requireAPIContract(t, "POST", "/api/system/appendKeyboardLog", recorder)
		}
		return recorder
	}
	valid := `{"session":"test-20006","entries":[{"seq":1,"time":1,"stage":"command-enter","event":1,"command":"search"}]}`
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor} {
		if response := request(role, valid); response.Code != http.StatusForbidden {
			t.Fatalf("non-admin admitted: %s", response.Body)
		}
	}
	if response := request(model.RoleVisitor, valid); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated request admitted: %s", response.Body)
	}
	if response := request(model.RoleAdministrator, valid); !strings.Contains(response.Body.String(), `"code":0`) {
		t.Fatalf("read-only diagnostic write failed: %s", response.Body)
	}
	for _, body := range []string{
		`{}`, `{"session":"test","entries":[]}`, strings.Replace(valid, `"seq":1`, `"seq":"1"`, 1),
		strings.Replace(valid, `"stage":"command-enter"`, `"stage":"unknown"`, 1),
		strings.Replace(valid, `"command":"search"`, `"command":"private-document"`, 1),
		strings.Replace(valid, `"command":"search"`, `"detail":"private-pinyin"`, 1),
		strings.TrimSuffix(valid, "}") + `,"padding":"` + strings.Repeat("x", 65536) + `"}`,
	} {
		response := request(model.RoleAdministrator, body)
		var result struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code >= 0 {
			t.Fatalf("invalid diagnostic accepted: %s", response.Body)
		}
	}
	data, err := os.ReadFile(logging.LogPath)
	if err != nil || !strings.Contains(string(data), "keyboard diagnostic [issue=20006]") || strings.Contains(string(data), "private-") {
		t.Fatalf("diagnostic log missing or contains rejected text: %s %v", data, err)
	}
	if path := model.ExportSystemLog(); path == "" {
		t.Fatal("system log export failed")
	}
	archive, err := archiveZip.OpenReader(filepath.Join(util.TempDir, "export", "system-log.zip"))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, file := range archive.File {
		if strings.HasSuffix(file.Name, "/siyuan.log") {
			input, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			exported, err := io.ReadAll(input)
			input.Close()
			if err != nil || !strings.Contains(string(exported), "test-20006") {
				t.Fatalf("export dropped keyboard diagnostics: %s %v", exported, err)
			}
			return
		}
	}
	t.Fatal("system log archive lacks siyuan.log")
}

func TestAPIContractKeyboardDiagnosticLimits(t *testing.T) {
	request := apicontract.SystemKeyboardLogRequest{Session: "test", Entries: []apicontract.SystemKeyboardLogEntry{{Seq: 1, Time: 1, Stage: "capture"}}}
	if !validKeyboardLog(request) {
		t.Fatal("valid diagnostic rejected")
	}
	request.Entries[0].Keyboard = &apicontract.SystemKeyboardLogEvent{Key: "private-pinyin", Code: "Other", Target: "editor"}
	if validKeyboardLog(request) {
		t.Fatal("arbitrary keyboard text accepted")
	}
	request.Entries[0].Keyboard.Key = "Other"
	if !validKeyboardLog(request) {
		t.Fatal("redacted keyboard event rejected")
	}
	for len(request.Entries) < 51 {
		request.Entries = append(request.Entries, request.Entries[0])
	}
	if validKeyboardLog(request) {
		t.Fatal("oversized batch accepted")
	}
}
