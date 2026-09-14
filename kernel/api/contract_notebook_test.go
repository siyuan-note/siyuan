package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractNotebookConfConversion(t *testing.T) {
	for _, bytes := range [][]byte{nil, {}, {0, 1, 254, 255}} {
		value := conf.NewBoxConf()
		value.BoxCrypt = &conf.BoxEncryption{Spec: 2, WrappedDEK: bytes, WrapNonce: bytes, Metadata: bytes, CreatedAt: 1234567890}
		before, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(notebookConfContract(value))
		if err != nil || string(before) != string(after) {
			t.Fatalf("configuration serialization changed: %s != %s, %v", before, after, err)
		}
	}
	value := conf.NewBoxConf()
	before, _ := json.Marshal(value)
	after, err := json.Marshal(notebookConfContract(value))
	if err != nil || string(before) != string(after) {
		t.Fatalf("unencrypted configuration serialization changed: %v", err)
	}
}

func TestAPIContractNotebookBackupMissingFile(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("password", " secret "); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/notebook/importNotebookCryptoBackup", importNotebookCryptoBackup)
	request := httptest.NewRequest(http.MethodPost, "/api/notebook/importNotebookCryptoBackup", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != "file not found" {
		t.Fatalf("missing backup error changed: %s, %v", recorder.Body.String(), err)
	}
}

func TestAPIContractNotebookInfoConversion(t *testing.T) {
	for _, info := range []*model.BoxInfo{nil, {}, {ID: "20260101000000-abcdefg", Name: "Notebook", DocCount: 12, Size: 123456789, HSize: "117.7 MB", Mtime: 1700000000, CTime: 1600000000, HMtime: "now", HCtime: "ago"}} {
		before, err := json.Marshal(info)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(notebookInfoContract(info))
		if err != nil || string(before) != string(after) {
			t.Fatalf("notebook info serialization changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractNotebookCryptoAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		ServeAPI(engine)
		for _, name := range []string{"enableEncryptedNotebooks", "disableEncryptedNotebooks", "createEncryptedNotebook", "unlockNotebook", "unlockAndOpenNotebook", "lockNotebook", "setNotebookCryptoAutoLock", "setEncryptedNotebookFollowSystemLock", "lockEncryptedNotebooksOnSystemLock", "changeMasterPassword", "exportNotebookCryptoBackup", "importNotebookCryptoBackup"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/notebook/"+name, strings.NewReader(`{}`)))
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("role %v reached %s: %d %s", role, name, recorder.Code, recorder.Body.String())
			}
		}
	}
}
