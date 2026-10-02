package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func settingsResetTestEnvironment(t *testing.T) {
	t.Helper()
	previousConf, previousConfDir, previousDataDir, previousReadonly := Conf, util.ConfDir, util.DataDir, util.ReadOnly
	previousMarkdown, previousSingleLine, previousWarning := util.MarkdownSettings, util.UseSingleLineSave, util.LargeFileWarningSize
	t.Cleanup(func() {
		Conf, util.ConfDir, util.DataDir, util.ReadOnly = previousConf, previousConfDir, previousDataDir, previousReadonly
		util.MarkdownSettings, util.UseSingleLineSave, util.LargeFileWarningSize = previousMarkdown, previousSingleLine, previousWarning
	})
	root := t.TempDir()
	util.ConfDir, util.DataDir, util.ReadOnly = filepath.Join(root, "conf"), filepath.Join(root, "data"), false
	for _, dir := range []string{util.ConfDir, filepath.Join(util.DataDir, "storage")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.Lang = "ja"
	Conf.System = conf.NewSystem()
	Conf.Editor = conf.NewEditor()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.NotebookCrypto.MasterSalt = []byte("retained-salt")
	Conf.NotebookCrypto.HistoryKEKs = [][]byte{[]byte("retained-history-key")}
	Conf.AccessAuthCode = "screen-lock"
	Conf.CookieKey = "cookie-signing-key"
	Conf.MCPOAuth = "encrypted-oauth"
	Conf.UserData = "encrypted-account"
	Conf.Api = conf.NewAPI()
	Conf.Api.Token = "preserved-token"
	Conf.AI = conf.NewAI()
	Conf.AI.Providers = []*conf.Provider{{APIKey: "retained-provider-key"}}
	Conf.OIDC.ClientSecret = "retained-oidc-secret"
	Conf.Secrets = &conf.Secrets{Items: []*conf.Secret{{Name: "secret", Value: "retained-secret"}}}
	Conf.Sync = conf.NewSync()
	Conf.Repo = conf.NewRepo()
	Conf.Snippet = conf.NewSnpt()
	Conf.Bazaar = conf.NewBazaar()
	Conf.Bazaar.PetalDisabled = true
	Conf.Save()
}

func TestSettingsResetPreservesDataAndProtectedConfiguration(t *testing.T) {
	settingsResetTestEnvironment(t)
	Conf.Editor.FontSize = 31
	Conf.Editor.HistoryRetentionDays = 3650
	Conf.System.AutoLaunch2 = 2
	Conf.System.NetworkServe = true
	Conf.System.NetworkServeTLS = true
	Conf.System.NetworkProxy = &conf.NetworkProxy{Host: "proxy"}
	Conf.System.LockScreenMode = 1
	Conf.System.EncryptedNotebookFollowSystemLock = true
	Conf.System.DownloadInstallPkg = false
	util.MarkdownSettings = util.NewMarkdown()
	util.MarkdownSettings.InlineMath = false
	util.UseSingleLineSave, util.LargeFileWarningSize = false, 64
	keymap := conf.Keymap{"general": map[string]any{"test": "custom"}, "editor": map[string]any{}, "plugin": map[string]any{"kept": true}}
	Conf.Keymap = &keymap
	Conf.Save()
	protected := *Conf
	storage := []byte(`{"local-zoom":2,"local-mobile-bars":{"autoHide":false},"local-layouts":[{"name":"saved"}],"plugin-unknown":{"key":"value"}}`)
	if err := filelock.WriteFile(settingsResetPaths()[1], storage); err != nil {
		t.Fatal(err)
	}
	document := filepath.Join(util.DataDir, "original.sy")
	ciphertext := []byte("existing encrypted document bytes")
	if err := os.WriteFile(document, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := ResetSettings(); err != nil {
			t.Fatal(err)
		}
		if Conf.Editor.FontSize != 16 || !Conf.Editor.Markdown.InlineMath || !Conf.FileTree.UseSingleLineSave || Conf.FileTree.LargeFileWarningSize != 8 {
			t.Fatal("reset must not inherit mutable runtime defaults")
		}
		if Conf.Editor.HistoryRetentionDays != 3650 || Conf.Lang != "ja" || Conf.Appearance.Lang != "ja" {
			t.Fatal("retention and language must be preserved")
		}
		if Conf.NotebookCrypto != protected.NotebookCrypto || Conf.Api != protected.Api || Conf.AccessAuthCode != protected.AccessAuthCode ||
			Conf.CookieKey != protected.CookieKey || Conf.MCPOAuth != protected.MCPOAuth || Conf.UserData != protected.UserData ||
			Conf.Snippet != protected.Snippet || Conf.Bazaar != protected.Bazaar || Conf.AI != protected.AI ||
			Conf.OIDC != protected.OIDC || Conf.Secrets != protected.Secrets || Conf.Sync != protected.Sync || Conf.Repo != protected.Repo {
			t.Fatal("protected configuration changed")
		}
		if Conf.System.AutoLaunch2 != 2 || !Conf.System.NetworkServe || !Conf.System.NetworkServeTLS ||
			Conf.System.NetworkProxy.Host != "proxy" || Conf.System.LockScreenMode != 1 || !Conf.System.EncryptedNotebookFollowSystemLock {
			t.Fatal("host, networking and authentication settings changed")
		}
		if !reflect.DeepEqual((*Conf.Keymap)["plugin"], keymap["plugin"]) || (*Conf.Keymap)["general"] != nil {
			t.Fatal("only built-in shortcuts should be reset")
		}
	}
	data, err := os.ReadFile(document)
	if err != nil || !bytes.Equal(data, ciphertext) {
		t.Fatal("document bytes changed")
	}
	data, err = os.ReadFile(settingsResetPaths()[1])
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]json.RawMessage
	if err = json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["local-zoom"] != nil || stored["local-mobile-bars"] != nil || stored["local-layouts"] == nil || stored["plugin-unknown"] == nil {
		t.Fatal("local storage whitelist was not respected")
	}
	data, err = os.ReadFile(settingsResetPaths()[0])
	if err != nil {
		t.Fatal(err)
	}
	var reloaded AppConf
	if err = json.Unmarshal(data, &reloaded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(reloaded.NotebookCrypto, protected.NotebookCrypto) {
		t.Fatal("persisted recovery material changed")
	}
	if bytes.Contains(data, []byte("retained-provider-key")) || bytes.Contains(data, []byte("retained-oidc-secret")) ||
		bytes.Contains(data, []byte("retained-secret")) {
		t.Fatal("reset persisted plaintext credentials")
	}
	reloaded.AI.DecryptAPIKeys()
	reloaded.OIDC.DecryptClientSecret()
	reloaded.Secrets.Decrypt()
	if reloaded.AI.Providers[0].APIKey != Conf.AI.Providers[0].APIKey ||
		reloaded.OIDC.ClientSecret != Conf.OIDC.ClientSecret || reloaded.Secrets.Items[0].Value != Conf.Secrets.Items[0].Value {
		t.Fatal("credentials no longer decrypt after reset")
	}
}

func TestSettingsResetFailureAndRecovery(t *testing.T) {
	for _, interrupted := range []bool{false, true} {
		t.Run(map[bool]string{false: "write failure", true: "interruption"}[interrupted], func(t *testing.T) {
			settingsResetTestEnvironment(t)
			paths := settingsResetPaths()
			original, err := os.ReadFile(paths[0])
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			func() {
				defer func() {
					if r := recover(); r != nil && !interrupted {
						t.Fatal(r)
					}
				}()
				err = writeSettingsReset([][]byte{[]byte(`{"replacement":true}`), []byte(`{}`), []byte(`{}`)}, func(path string, data []byte) error {
					calls++
					if calls == 2 {
						if interrupted {
							panic("simulated process interruption")
						}
						return errors.New("simulated disk failure")
					}
					return filelock.WriteFile(path, data)
				})
			}()
			if !interrupted && err == nil {
				t.Fatal("write failure must be reported")
			}
			if err = recoverSettingsReset(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(paths[0])
			if err != nil || !bytes.Equal(data, original) {
				t.Fatal("original configuration was not restored")
			}
			for _, path := range append(paths[1:], settingsResetJournalPath()) {
				if _, err = os.Stat(path); !os.IsNotExist(err) {
					t.Fatalf("unexpected file after rollback: %s", path)
				}
			}
		})
	}
}

func TestSettingsResetRejectsCorruptionAndReadonly(t *testing.T) {
	settingsResetTestEnvironment(t)
	before := Conf.Editor
	util.ReadOnly = true
	if ResetSettings() == nil {
		t.Fatal("readonly reset accepted")
	}
	util.ReadOnly = false
	if err := os.WriteFile(settingsResetPaths()[1], []byte("invalid json"), 0600); err != nil {
		t.Fatal(err)
	}
	if ResetSettings() == nil || Conf.Editor != before {
		t.Fatal("corrupt storage reset must preserve configuration")
	}
	if err := os.WriteFile(settingsResetJournalPath(), []byte(`{"version":99,"files":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if recoverSettingsReset() == nil {
		t.Fatal("unknown recovery format accepted")
	}
	if _, err := os.Stat(settingsResetJournalPath()); err != nil {
		t.Fatal("unknown recovery material was removed")
	}
	original, err := os.ReadFile(settingsResetPaths()[0])
	if err != nil {
		t.Fatal(err)
	}
	journal, err := json.Marshal(settingsResetJournal{Version: 1, Files: []settingsResetFile{
		{Exists: true, Data: original}, {Exists: true, Data: []byte("corrupt")}, {},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(settingsResetJournalPath(), journal, 0600); err != nil {
		t.Fatal(err)
	}
	if recoverSettingsReset() == nil {
		t.Fatal("corrupt recovery data accepted")
	}
	after, err := os.ReadFile(settingsResetPaths()[1])
	if err != nil || !bytes.Equal(after, []byte("invalid json")) {
		t.Fatal("corrupt recovery must not overwrite existing files")
	}
}

func TestSettingsResetRollbackFailureStopsWrites(t *testing.T) {
	const rootEnv = "SIYUAN_TEST_SETTINGS_RESET_ROOT"
	const modeEnv = "SIYUAN_TEST_SETTINGS_RESET_MODE"
	if root := os.Getenv(rootEnv); root != "" {
		util.ConfDir, util.DataDir = filepath.Join(root, "conf"), filepath.Join(root, "data")
		Conf = NewAppConf()
		paths := settingsResetPaths()
		if os.Getenv(modeEnv) == "pending" {
			journal := settingsResetJournal{Version: 1}
			for _, path := range paths {
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				journal.Files = append(journal.Files, settingsResetFile{Exists: true, Data: data})
			}
			data, err := json.Marshal(journal)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(settingsResetJournalPath(), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
		blockRollback := func() {
			if err := os.Remove(paths[1]); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(paths[1], 0755); err != nil {
				t.Fatal(err)
			}
		}
		if os.Getenv(modeEnv) == "pending" {
			blockRollback()
			_ = ResetSettings()
		} else {
			_ = writeSettingsReset([][]byte{[]byte(`{}`), []byte(`{}`), []byte(`{}`)}, func(path string, data []byte) error {
				if path == paths[1] {
					blockRollback()
					return errors.New("simulated disk failure")
				}
				return filelock.WriteFile(path, data)
			})
		}
		t.Fatal("failed recovery allowed further writes")
	}
	for _, mode := range []string{"rollback", "pending"} {
		t.Run(mode, func(t *testing.T) {
			settingsResetTestEnvironment(t)
			paths := settingsResetPaths()
			original, err := os.ReadFile(paths[0])
			if err != nil {
				t.Fatal(err)
			}
			originals := [][]byte{original, []byte(`{"plugin":"retained"}`), []byte(`{}`)}
			for i, path := range paths {
				if err = filelock.WriteFile(path, originals[i]); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSettingsResetRollbackFailureStopsWrites$")
			cmd.Env = append(os.Environ(), rootEnv+"="+filepath.Dir(util.ConfDir), modeEnv+"="+mode)
			output, err := cmd.CombinedOutput()
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) || exitErr.ExitCode() != logging.ExitCodeFileSysErr {
				t.Fatalf("expected fatal file-system exit, got %v\n%s", err, output)
			}
			if _, err = os.Stat(settingsResetJournalPath()); err != nil {
				t.Fatalf("recovery journal was not preserved: %v", err)
			}
			if err = os.Remove(paths[1]); err != nil {
				t.Fatal(err)
			}
			if err = recoverSettingsReset(); err != nil {
				t.Fatal(err)
			}
			for i, path := range paths {
				data, readErr := os.ReadFile(path)
				if readErr != nil || !bytes.Equal(data, originals[i]) {
					t.Fatalf("original configuration was not recovered: %s, %v", path, readErr)
				}
			}
			Conf.Api.Token = "token-after-successful-recovery"
			Conf.Save()
			if err = recoverSettingsReset(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(paths[0])
			if err != nil || !bytes.Contains(data, []byte(Conf.Api.Token)) {
				t.Fatal("recovery reverted a later configuration save")
			}
		})
	}
}
