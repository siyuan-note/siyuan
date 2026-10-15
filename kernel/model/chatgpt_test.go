package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func chatGPTBindingTestEnvironment(t *testing.T) {
	t.Helper()
	home, workspace, dir, readOnly := util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly
	persisted := lastPersistedConf()
	t.Cleanup(func() {
		util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly = home, workspace, dir, readOnly
		recordPersistedConf(persisted)
	})
	util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly = t.TempDir(), t.TempDir(), t.TempDir(), false
}

func TestChatGPTBindingsSurviveCopiedConfiguration(t *testing.T) {
	previousHome, previousWorkspace := util.HomeDir, util.WorkspaceDir
	defer func() { util.HomeDir, util.WorkspaceDir = previousHome, previousWorkspace }()
	util.WorkspaceDir = t.TempDir()
	deviceA, deviceB := t.TempDir(), t.TempDir()
	provider := func(id string) *conf.AI {
		return &conf.AI{Providers: []*conf.Provider{{ID: "provider", AuthType: "chatgpt", AccountID: id}}}
	}
	for _, entry := range []struct{ home, account string }{{deviceA, "account-A"}, {deviceB, "account-B"}} {
		util.HomeDir = entry.home
		if err := util.ChatGPTService().SaveBindings(context.Background(), util.WorkspaceDir, map[string]string{"provider": entry.account}); err != nil {
			t.Fatal(err)
		}
	}
	source := NewAppConf()
	source.AI.Store(provider("account-A"))
	data, err := source.marshalForSave()
	if err != nil || bytes.Contains(data, []byte("accountID")) || source.AI.Load().Providers[0].AccountID != "account-A" {
		t.Fatalf("persisted configuration leaked or changed binding: %v", err)
	}
	for _, entry := range []struct{ home, account string }{{deviceA, "account-A"}, {deviceB, "account-B"}, {t.TempDir(), ""}} {
		util.HomeDir = entry.home
		copied := NewAppConf()
		if err = json.Unmarshal(data, copied); err != nil {
			t.Fatal(err)
		}
		// 模拟外部配置携带其他设备的引用，加载时只认当前设备的绑定。
		copied.AI.Load().Providers[0].AccountID = "foreign-account"
		if err = LoadChatGPTAccountBindings(copied.AI.Load()); err != nil {
			t.Fatal(err)
		}
		if got := copied.AI.Load().Providers[0].AccountID; got != entry.account {
			t.Fatalf("loaded account %q, want %q", got, entry.account)
		}
	}
	util.HomeDir = deviceB
	util.WorkspaceDir = t.TempDir()
	ai := provider("foreign-account")
	if err = LoadChatGPTAccountBindings(ai); err != nil || ai.Providers[0].AccountID != "" {
		t.Fatal("another workspace inherited an account binding")
	}
}

func TestChatGPTBindingSaveFailureRetainsRuntimeConfiguration(t *testing.T) {
	previousHome, previousWorkspace, previousDir, previousReadOnly := util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly
	defer func() {
		util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly = previousHome, previousWorkspace, previousDir, previousReadOnly
	}()
	util.HomeDir, util.WorkspaceDir, util.ConfDir, util.ReadOnly = t.TempDir(), t.TempDir(), t.TempDir(), false
	app := NewAppConf()
	ai := &conf.AI{Providers: []*conf.Provider{{ID: "provider", AuthType: "chatgpt", AccountID: "local-account"}}}
	if err := app.SetAI(context.Background(), ai); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil || bytes.Contains(data, []byte("accountID")) {
		t.Fatal("saved configuration retained the account binding")
	}
	dir := filepath.Join(util.HomeDir, ".config", "siyuan", "chatgpt", "bindings")
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(files) != 1 {
		t.Fatalf("unexpected binding files: %v", files)
	}
	if err = os.WriteFile(files[0], []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = app.SetAI(context.Background(), &conf.AI{}); err == nil || app.AI.Load().Providers[0].AccountID != "local-account" {
		t.Fatal("failed binding save published a new configuration")
	}
	if err = LoadChatGPTAccountBindings(ai); err == nil || ai.Providers[0].AccountID != "" {
		t.Fatal("failed binding load retained a foreign account reference")
	}
}

func TestChatGPTUnchangedBindingsDoNotAccessLocalStore(t *testing.T) {
	chatGPTBindingTestEnvironment(t)
	app := NewAppConf()
	parent := filepath.Join(util.HomeDir, ".config", "siyuan")
	if err := os.MkdirAll(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "chatgpt"), []byte("unavailable store"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := app.SetAI(context.Background(), &conf.AI{Providers: []*conf.Provider{{APIKey: "ordinary-provider"}}}); err != nil {
		t.Fatalf("API key provider depends on ChatGPT storage: %v", err)
	}
	app.AI.Store(&conf.AI{Providers: []*conf.Provider{{ID: "provider", AuthType: "chatgpt", AccountID: "local-account"}}})
	next := cloneConfSection(app.AI.Load())
	next.Providers[0].Enabled = true
	if err := app.SetAI(context.Background(), next); err != nil || !app.AI.Load().Providers[0].Enabled {
		t.Fatalf("unchanged ChatGPT binding accessed local storage: %v", err)
	}
}

func TestChatGPTConfigurationFailureRetainsBindings(t *testing.T) {
	chatGPTBindingTestEnvironment(t)
	app := NewAppConf()
	ai := &conf.AI{Providers: []*conf.Provider{{ID: "provider", AuthType: "chatgpt", AccountID: "local-account"}}}
	if err := app.SetAI(context.Background(), ai); err != nil {
		t.Fatal(err)
	}
	originalDir := util.ConfDir
	original, err := os.ReadFile(filepath.Join(originalDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	util.ConfDir = filepath.Join(t.TempDir(), "blocked")
	if err = os.WriteFile(util.ConfDir, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = app.SetAI(context.Background(), &conf.AI{}); err == nil {
		t.Fatal("configuration failure accepted")
	}
	bindings, err := util.ChatGPTService().LoadBindings(util.WorkspaceDir)
	if err != nil || bindings["provider"] != "local-account" || app.AI.Load() != ai {
		t.Fatal("configuration failure changed persisted or runtime bindings")
	}
	current, err := os.ReadFile(filepath.Join(originalDir, "conf.json"))
	if err != nil || !bytes.Equal(current, original) {
		t.Fatal("configuration failure changed original configuration")
	}
}

func prepareChatGPTBindingTransaction(t *testing.T) (string, [][]byte) {
	t.Helper()
	path, err := util.ChatGPTService().BindingPath(util.WorkspaceDir)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(util.ConfDir, 0700); err != nil {
		t.Fatal(err)
	}
	before := [][]byte{[]byte(`{"ai":{"providers":[{"id":"provider"}]}}`), []byte(`{"version":1,"providers":{"provider":"account"}}`)}
	for i, file := range []string{filepath.Join(util.ConfDir, "conf.json"), path} {
		if err = writeChatGPTBindingFile(file, before[i]); err != nil {
			t.Fatal(err)
		}
	}
	return path, before
}

func assertChatGPTBindingTransactionRestored(t *testing.T, path string, before [][]byte) {
	t.Helper()
	for i, file := range []string{filepath.Join(util.ConfDir, "conf.json"), path} {
		data, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(data, before[i]) {
			t.Fatalf("transaction file %d was not restored: %v", i, err)
		}
	}
	if _, err := os.Stat(path + ".pending"); !os.IsNotExist(err) {
		t.Fatal("successful rollback retained a journal")
	}
}

func TestChatGPTBindingTransactionRollsBackEachWriteFailure(t *testing.T) {
	for _, failAt := range []int{0, 1} {
		t.Run(string(rune('0'+failAt)), func(t *testing.T) {
			chatGPTBindingTestEnvironment(t)
			path, before := prepareChatGPTBindingTransaction(t)
			writes := 0
			err := writeChatGPTBindingConfiguration(path, []byte(`{"version":1,"providers":{}}`), []byte(`{"ai":{}}`), func(file string, data []byte) error {
				index := writes
				writes++
				if index == failAt {
					return errors.New("injected write failure")
				}
				return writeChatGPTBindingFile(file, data)
			})
			if err == nil {
				t.Fatal("failed transaction accepted")
			}
			assertChatGPTBindingTransactionRestored(t, path, before)
		})
	}
}

func TestChatGPTBindingInterruptedSaveRecovery(t *testing.T) {
	const rootEnv, stepEnv = "SIYUAN_CHATGPT_RECOVERY_ROOT", "SIYUAN_CHATGPT_RECOVERY_STEP"
	if root := os.Getenv(rootEnv); root != "" {
		util.HomeDir, util.WorkspaceDir = filepath.Join(root, "home"), filepath.Join(root, "workspace")
		util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
		path, _ := util.ChatGPTService().BindingPath(util.WorkspaceDir)
		index := 0
		_ = writeChatGPTBindingConfiguration(path, []byte(`{"version":1,"providers":{}}`), []byte(`{"ai":{}}`), func(file string, data []byte) error {
			if err := writeChatGPTBindingFile(file, data); err != nil {
				return err
			}
			if string(rune('0'+index)) == os.Getenv(stepEnv) {
				os.Exit(0)
			}
			index++
			return nil
		})
		t.Fatal("interruption was not reached")
	}
	for _, step := range []string{"0", "1"} {
		t.Run(step, func(t *testing.T) {
			chatGPTBindingTestEnvironment(t)
			root := t.TempDir()
			util.HomeDir, util.WorkspaceDir = filepath.Join(root, "home"), filepath.Join(root, "workspace")
			util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
			path, before := prepareChatGPTBindingTransaction(t)
			command := exec.Command(os.Args[0], "-test.run=^TestChatGPTBindingInterruptedSaveRecovery$")
			command.Env = append(os.Environ(), rootEnv+"="+root, stepEnv+"="+step)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("interrupted process failed: %v %s", err, output)
			}
			if _, err := os.Stat(path + ".pending"); err != nil {
				t.Fatal("interrupted save lost the recovery journal")
			}
			if err := recoverChatGPTAccountBindings(); err != nil {
				t.Fatal(err)
			}
			assertChatGPTBindingTransactionRestored(t, path, before)
			if err := writeChatGPTBindingFile(filepath.Join(util.ConfDir, "conf.json"), []byte(`{"later":true}`)); err != nil {
				t.Fatal(err)
			}
			if err := recoverChatGPTAccountBindings(); err != nil {
				t.Fatal(err)
			}
			data, _ := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
			if string(data) != `{"later":true}` {
				t.Fatal("completed recovery reverted a later save")
			}
		})
	}
}

func TestChatGPTBindingUnknownJournalPreservesFiles(t *testing.T) {
	chatGPTBindingTestEnvironment(t)
	path, before := prepareChatGPTBindingTransaction(t)
	raw := []byte(`{"version":2,"files":[]}`)
	if err := os.WriteFile(path+".pending", raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverChatGPTAccountBindings(); err == nil {
		t.Fatal("unknown recovery journal accepted")
	}
	data, _ := os.ReadFile(path + ".pending")
	if !bytes.Equal(data, raw) {
		t.Fatal("unknown journal was modified")
	}
	for i, file := range []string{filepath.Join(util.ConfDir, "conf.json"), path} {
		data, _ = os.ReadFile(file)
		if !bytes.Equal(data, before[i]) {
			t.Fatal("unknown journal changed configuration files")
		}
	}
}
