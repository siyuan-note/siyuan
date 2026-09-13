package api

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractNotebookPasswordRecovery(t *testing.T) {
	const helper = "SIYUAN_TEST_NOTEBOOK_PASSWORD_RECOVERY"
	if os.Getenv(helper) != "1" {
		// 加密缓存和数据库属于进程级状态，在独立进程中验证完整恢复链路。
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractNotebookPasswordRecovery$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("password recovery subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir = filepath.Join(root, "data"), filepath.Join(root, "temp")
	util.ConfDir, util.HistoryDir = filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewFileTree()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Editor, model.Conf.Search, model.Conf.Export = conf.NewEditor(), conf.NewSearch(), conf.NewExport()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	const originalPassword = " old password\t"
	const newPassword = "\u00a0new password\u3000"
	// 使用未经过接口规范化的模型入口准备已有密码，模拟升级前创建的密钥域。
	if err := model.EnableEncryptedNotebook(originalPassword); err != nil {
		t.Fatal(err)
	}
	salt := bytes.Clone(model.Conf.NotebookCrypto.MasterSalt)
	boxID, err := model.CreateEncryptedBox("Password recovery", originalPassword)
	if err != nil {
		t.Fatal(err)
	}
	dek, err := model.GetDEK(boxID)
	if err != nil {
		t.Fatal(err)
	}
	const assetName = "fixture.bin"
	ciphertext, err := model.EncryptAsset(boxID, assetName, assetName, dek, []byte("existing encrypted data"))
	if err != nil {
		t.Fatal(err)
	}
	model.Unmount(boxID)
	model.LockBox(boxID)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/notebook/enableEncryptedNotebooks", enableEncryptedNotebooks)
	engine.POST("/api/notebook/unlockNotebook", unlockNotebook)
	engine.POST("/api/notebook/unlockAndOpenNotebook", unlockAndOpenNotebook)
	engine.POST("/api/notebook/changeMasterPassword", changeMasterPassword)
	engine.POST("/api/notebook/importNotebookCryptoBackup", importNotebookCryptoBackup)
	request := func(req *http.Request, success bool) {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		requireAPIContract(t, http.MethodPost, req.URL.Path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code == 0) != success {
			t.Fatalf("%s: unexpected response %s, %v", req.URL.Path, recorder.Body.String(), err)
		}
	}
	post := func(endpoint string, body map[string]string, success bool) {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/notebook/"+endpoint, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		request(req, success)
	}
	verifyContent := func() {
		t.Helper()
		key, err := model.GetDEK(boxID)
		if err != nil {
			t.Fatal(err)
		}
		plain, err := model.DecryptAsset(boxID, assetName, key, ciphertext)
		if err != nil || string(plain) != "existing encrypted data" || !bytes.Equal(salt, model.Conf.NotebookCrypto.MasterSalt) {
			t.Fatalf("existing data or master salt changed: %v", err)
		}
		model.Unmount(boxID)
		model.LockBox(boxID)
	}
	post("enableEncryptedNotebooks", map[string]string{"password": originalPassword}, true)
	for _, endpoint := range []string{"unlockNotebook", "unlockAndOpenNotebook"} {
		post(endpoint, map[string]string{"notebook": boxID, "password": strings.TrimSpace(originalPassword)}, false)
		post(endpoint, map[string]string{"notebook": boxID, "password": originalPassword}, true)
		verifyContent()
	}
	post("changeMasterPassword", map[string]string{"oldPassword": strings.TrimSpace(originalPassword), "newPassword": newPassword}, false)
	post("changeMasterPassword", map[string]string{"oldPassword": originalPassword, "newPassword": newPassword}, true)
	post("unlockNotebook", map[string]string{"notebook": boxID, "password": strings.TrimSpace(newPassword)}, false)
	post("unlockNotebook", map[string]string{"notebook": boxID, "password": newPassword}, true)
	verifyContent()
	backupPath, err := model.ExportNotebookCryptoBackup()
	if err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(filepath.Join(util.TempDir, "export", filepath.Base(backupPath)))
	if err != nil {
		t.Fatal(err)
	}
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	for _, password := range []string{strings.TrimSpace(newPassword), newPassword} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, err := writer.CreateFormFile("file", "backup.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write(backup); err != nil {
			t.Fatal(err)
		}
		if err = writer.WriteField("password", password); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/notebook/importNotebookCryptoBackup", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		request(req, password == newPassword)
	}
	post("unlockNotebook", map[string]string{"notebook": boxID, "password": newPassword}, true)
	verifyContent()
}
