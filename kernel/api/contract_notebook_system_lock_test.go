package api

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestAPIContractNotebookSystemLock(t *testing.T) {
	const helper = "SIYUAN_TEST_NOTEBOOK_SYSTEM_LOCK"
	if os.Getenv(helper) != "1" {
		// 独立进程隔离数据库、密钥缓存和全局配置。
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractNotebookSystemLock$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("system lock subprocess failed: %v\n%s", err, output)
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
	model.Conf.Sync, model.Conf.System = conf.NewSync(), conf.NewSystem()
	model.Conf.Editor, model.Conf.Search, model.Conf.Export = conf.NewEditor(), conf.NewSearch(), conf.NewExport()
	model.Conf.Api = &conf.API{Token: "system-lock-test"}
	model.Conf.AccessAuthCode = "application-lock-password"
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	const password = "existing master password"
	if err := model.EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxIDs := make([]string, 0, 2)
	for range 2 {
		boxID, err := model.CreateEncryptedBox("System lock", password)
		if err != nil {
			t.Fatal(err)
		}
		boxIDs = append(boxIDs, boxID)
	}
	// 第二本仅解锁而不挂载，锁定仍须清除其密钥。
	model.Unmount(boxIDs[1])
	boxConf := (&model.Box{ID: boxIDs[1]}).GetConf()
	if err := model.UnlockBox(boxIDs[1], password, boxConf.BoxCrypt); err != nil {
		t.Fatal(err)
	}
	key, err := model.GetDEK(boxIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := model.EncryptAsset(boxIDs[0], "fixture.bin", "fixture.bin", key, []byte("preserved content"))
	if err != nil {
		t.Fatal(err)
	}
	cryptoBefore, _ := json.Marshal(model.Conf.NotebookCrypto)
	backupPath := filepath.Join(util.DataDir, ".siyuan", "data-crypto-backup.json")
	backupBefore, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	checkExternalAssetLocked := testResolveEncryptedAssetPath(t, boxIDs[0], key)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/notebook/setEncryptedNotebookFollowSystemLock", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, setEncryptedNotebookFollowSystemLock)
	engine.POST("/api/notebook/lockEncryptedNotebooksOnSystemLock", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, lockEncryptedNotebooksOnSystemLock)
	post := func(endpoint, body string) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/api/notebook/"+endpoint, strings.NewReader(body))
		request.Header.Set("Authorization", "Token system-lock-test")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("%s: %s, %v", endpoint, recorder.Body.String(), err)
		}
	}
	post("lockEncryptedNotebooksOnSystemLock", `{}`)
	for _, id := range boxIDs {
		if !model.IsBoxUnlocked(id) {
			t.Fatal("disabled setting locked a notebook")
		}
	}
	post("setEncryptedNotebookFollowSystemLock", `{"enabled":true}`)
	cryptoAfter, _ := json.Marshal(model.Conf.NotebookCrypto)
	backupAfter, _ := os.ReadFile(backupPath)
	if !bytes.Equal(cryptoBefore, cryptoAfter) || !bytes.Equal(backupBefore, backupAfter) {
		t.Fatal("local lock setting changed key configuration or backup")
	}
	saved, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	var persisted struct {
		System conf.System `json:"system"`
	}
	if err != nil || json.Unmarshal(saved, &persisted) != nil || !persisted.System.EncryptedNotebookFollowSystemLock {
		t.Fatalf("system lock setting was not persisted: %v", err)
	}
	model.SetAutoLockMinutes(0)
	// 锁定须先关闭新的读取准入，并等待已有读取释放租约。
	if err := model.AcquireEncryptedBoxOperation(boxIDs[0]); err != nil {
		t.Fatal(err)
	}
	locked := make(chan struct{})
	go func() {
		defer close(locked)
		post("lockEncryptedNotebooksOnSystemLock", `{}`)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for model.GetEncryptedBoxState(boxIDs[0]) != model.EncryptedBoxStateLocking && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	state := model.GetEncryptedBoxState(boxIDs[0])
	select {
	case <-locked:
		model.ReleaseEncryptedBoxOperation(boxIDs[0])
		t.Fatal("system lock completed before the active read released its lease")
	default:
	}
	model.ReleaseEncryptedBoxOperation(boxIDs[0])
	if state != model.EncryptedBoxStateLocking {
		t.Fatalf("system lock did not close admission: %s", state)
	}
	select {
	case <-locked:
	case <-time.After(10 * time.Second):
		t.Fatal("system lock did not finish after the active read released its lease")
	}
	post("lockEncryptedNotebooksOnSystemLock", `{}`)
	for _, id := range boxIDs {
		if model.IsBoxUnlocked(id) {
			t.Fatal("system lock retained an unlocked notebook")
		}
		if err := model.AcquireEncryptedBoxOperation(id); err == nil {
			model.ReleaseEncryptedBoxOperation(id)
			t.Fatal("locked notebook admitted a read")
		}
	}
	checkExternalAssetLocked()
	boxConf = (&model.Box{ID: boxIDs[0]}).GetConf()
	if err = model.UnlockBox(boxIDs[0], password, boxConf.BoxCrypt); err != nil {
		t.Fatal(err)
	}
	key, err = model.GetDEK(boxIDs[0])
	if err != nil {
		t.Fatal(err)
	}
	plain, err := model.DecryptAsset(boxIDs[0], "fixture.bin", key, ciphertext)
	if err != nil || string(plain) != "preserved content" {
		t.Fatalf("existing encrypted data could not be read after unlocking: %v", err)
	}
	post("setEncryptedNotebookFollowSystemLock", `{"enabled":false}`)
	post("lockEncryptedNotebooksOnSystemLock", `{}`)
	if !model.IsBoxUnlocked(boxIDs[0]) {
		t.Fatal("disabled system lock still locked notebook")
	}
	model.Unmount(boxIDs[0])
}
