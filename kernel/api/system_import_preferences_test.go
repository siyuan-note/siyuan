package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func importedPreferencesFixture(t *testing.T) {
	t.Helper()
	previous := model.Conf
	home, workspace, confDir, temp, readOnly := util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly
	t.Cleanup(func() {
		model.Conf = previous
		util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly = home, workspace, confDir, temp, readOnly
		model.ApplyConfRuntime()
	})
	util.HomeDir, util.WorkspaceDir, util.ConfDir, util.TempDir, util.ReadOnly = t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir(), false
	model.Conf = model.NewAppConf()
	model.NormalizeAppConf(model.Conf)
}

func importPreferencesRequest(t *testing.T, name string, data []byte) int {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/system/importConf", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	importConf(c)
	requireAPIContract(t, "POST", "/api/system/importConf", recorder)
	var response struct {
		Code int `json:"code"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("invalid import response: %s (%v)", recorder.Body.String(), err)
	}
	return response.Code
}

func TestAPIContractImportedPortablePreferences(t *testing.T) {
	importedPreferencesFixture(t)
	source := model.Conf
	source.Lang = "ja"
	appearance := source.Appearance.Load()
	appearance.Lang = "ja"
	appearance.HideStatusBar = true
	appearance.ModeOS = false
	appearance.Mode = 1
	appearance.CompactMode = true
	appearance.MenuMouseScroll = true
	appearance.OutlineKeepCurrentExpand = true
	appearance.PDFTheme = &conf.PDFTheme{Light: "dark", Dark: "light", AnnoColor: "red"}
	appearance.MobileBars = &conf.MobileBars{AutoHide: new(false), SidebarSwipe: new(false), SidebarButtons: new(true)}
	source.FileTree.Load().RecentDocsSort = "updated"
	source.AI.Load().Agent.StreamingMarkdown = true
	appearance.GlobalFontFamilies = []*conf.EditorFont{{Family: "serif"}}
	appearance.EntryVisibility = &conf.EntryVisibility{Version: conf.EntryVisibilityVersion, Active: "portable",
		Profiles: []*conf.EntryVisibilityProfile{{ID: "portable", Name: "Portable", Defaults: conf.EntryVisibilityProfileFull,
			Entries: map[string]bool{"topBar.search": false}, Orders: map[string][]string{"topBar": {"search", "config"}}}}}
	source.OCR.Store(&conf.OCR{Provider: "ai", AIModelID: "20261016120000-model01", Auto: true, ShowText: new(false), ShowError: true})
	source.Snippet.Store(&conf.Snpt{EnabledCSS: false, EnabledJS: false})
	source.Variables.Store(&conf.Variables{Items: []*conf.Variable{{Name: "PROJECT", Value: "portable"}}})
	source.UILayout.Store(&conf.UILayout{"layout": map[string]any{"type": "portable"}})
	model.NormalizeAppConf(source)
	recorder := systemContractRequest(t, http.MethodPost, "exportConf", exportConf, nil)
	var exported struct {
		Code int                              `json:"code"`
		Data apicontract.SystemExportConfData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &exported); err != nil || exported.Code != 0 {
		t.Fatalf("export failed: %s (%v)", recorder.Body.String(), err)
	}
	for _, ext := range []string{"", ".zip"} {
		t.Run("archive"+ext, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(util.TempDir, "export", exported.Data.Name+ext))
			if err != nil {
				t.Fatal(err)
			}
			model.Conf = model.NewAppConf()
			model.NormalizeAppConf(model.Conf)
			target := model.Conf
			target.Lang = "en"
			target.Appearance.Load().Lang = "en"
			target.Appearance.Load().Icons = []*conf.AppearanceIcon{{Name: "local-icons"}}
			target.Appearance.Load().DarkThemes = []*conf.AppearanceTheme{{Name: "local-dark"}}
			target.Appearance.Load().LightThemes = []*conf.AppearanceTheme{{Name: "local-light"}}
			target.Api.Load().Token = "local-api-token"
			target.AccessAuthCode = "local-lock-password"
			target.UserData = "local-account"
			target.Repo.Load().Key = []byte("local-repository-key")
			target.NotebookCrypto.MasterSalt = []byte("local-master-salt")
			target.NotebookCrypto.KEKVerifier = []byte("local-authenticated-verifier")
			target.NotebookCrypto.HistoryKEKs = [][]byte{[]byte("local-recovery-material")}
			target.System.Load().UpdateChannel = conf.UpdateChannelBeta
			proxy := &conf.NetworkProxy{Scheme: "system"}
			target.System.Load().NetworkProxy = proxy
			crypto, sync, api, repo, secrets := target.NotebookCrypto, target.Sync.Load(), target.Api.Load(), target.Repo.Load(), target.Secrets.Load()
			cryptoBefore, _ := json.Marshal(crypto)
			if code := importPreferencesRequest(t, exported.Data.Name+ext, data); code != 0 {
				t.Fatalf("import failed: %d", code)
			}
			actualAppearance := target.Appearance.Load()
			if !actualAppearance.CompactMode || !actualAppearance.MenuMouseScroll || !actualAppearance.OutlineKeepCurrentExpand ||
				!reflect.DeepEqual(actualAppearance.PDFTheme, source.Appearance.Load().PDFTheme) ||
				!reflect.DeepEqual(actualAppearance.MobileBars, source.Appearance.Load().MobileBars) ||
				target.FileTree.Load().RecentDocsSort != "updated" || !target.AI.Load().Agent.StreamingMarkdown {
				t.Fatal("reader and control preferences did not survive configuration transfer")
			}
			if target.Lang != "ja" || actualAppearance.Lang != "ja" || !actualAppearance.HideStatusBar || actualAppearance.Mode != 1 || actualAppearance.ModeOS ||
				!reflect.DeepEqual(actualAppearance.EntryVisibility, source.Appearance.Load().EntryVisibility) ||
				!reflect.DeepEqual(actualAppearance.GlobalFontFamilies, source.Appearance.Load().GlobalFontFamilies) ||
				!reflect.DeepEqual(target.OCR.Load(), source.OCR.Load()) || !reflect.DeepEqual(target.Snippet.Load(), source.Snippet.Load()) ||
				!reflect.DeepEqual(target.Variables.Load(), source.Variables.Load()) || !reflect.DeepEqual(target.UILayout.Load(), source.UILayout.Load()) {
				t.Fatal("portable preferences did not survive configuration transfer")
			}
			if len(actualAppearance.Icons) != 1 || actualAppearance.Icons[0].Name != "local-icons" ||
				len(actualAppearance.DarkThemes) != 1 || actualAppearance.DarkThemes[0].Name != "local-dark" ||
				len(actualAppearance.LightThemes) != 1 || actualAppearance.LightThemes[0].Name != "local-light" {
				t.Fatal("import replaced local appearance resources")
			}
			cryptoAfter, _ := json.Marshal(target.NotebookCrypto)
			if target.NotebookCrypto != crypto || !bytes.Equal(cryptoBefore, cryptoAfter) || target.Sync.Load() != sync || target.Api.Load() != api ||
				target.Repo.Load() != repo || target.Secrets.Load() != secrets || target.Api.Load().Token != "local-api-token" ||
				target.AccessAuthCode != "local-lock-password" || target.UserData != "local-account" ||
				target.System.Load().UpdateChannel != conf.UpdateChannelBeta || target.System.Load().NetworkProxy != proxy {
				t.Fatal("import replaced protected local configuration")
			}
			persisted, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
			if err != nil {
				t.Fatal(err)
			}
			saved := model.NewAppConf()
			if err = json.Unmarshal(persisted, saved); err != nil || saved.Lang != "ja" || saved.Appearance.Load().Lang != "ja" ||
				!reflect.DeepEqual(saved.OCR.Load(), source.OCR.Load()) || !reflect.DeepEqual(saved.Snippet.Load(), source.Snippet.Load()) ||
				!reflect.DeepEqual(saved.Variables.Load(), source.Variables.Load()) || !reflect.DeepEqual(saved.UILayout.Load(), source.UILayout.Load()) {
				t.Fatalf("imported preferences were not persisted: %v", err)
			}
			if !reflect.DeepEqual(saved.Appearance.Load().PDFTheme, source.Appearance.Load().PDFTheme) ||
				!reflect.DeepEqual(saved.Appearance.Load().MobileBars, source.Appearance.Load().MobileBars) ||
				!saved.Appearance.Load().CompactMode || !saved.Appearance.Load().MenuMouseScroll ||
				!saved.Appearance.Load().OutlineKeepCurrentExpand || saved.FileTree.Load().RecentDocsSort != "updated" ||
				!saved.AI.Load().Agent.StreamingMarkdown {
				t.Fatal("imported reader and control preferences were not persisted")
			}
		})
	}
}

func TestAPIContractImportedMissingPortablePreferences(t *testing.T) {
	importedPreferencesFixture(t)
	for _, payload := range []string{`{"editor":{}}`, `{"appearance":null,"ocr":null,"snippet":null,"variables":null}`} {
		appearance, ocr, snippet, variables := model.Conf.Appearance.Load(), model.Conf.OCR.Load(), model.Conf.Snippet.Load(), model.Conf.Variables.Load()
		model.Conf.Lang = "ja"
		appearance.Lang = "ja"
		if code := importPreferencesRequest(t, "old-settings.json", []byte(payload)); code != 0 {
			t.Fatalf("legacy import failed: %d", code)
		}
		if model.Conf.Appearance.Load() != appearance || model.Conf.OCR.Load() != ocr || model.Conf.Snippet.Load() != snippet ||
			model.Conf.Variables.Load() != variables || model.Conf.Lang != "ja" {
			t.Fatal("legacy import reset preferences missing from its package")
		}
	}
	if code := importPreferencesRequest(t, "old-settings.json", []byte(`{"lang":"zh_CN","appearance":{"hideStatusBar":true}}`)); code != 0 ||
		model.Conf.Lang != "zh-CN" || model.Conf.Appearance.Load().Lang != "zh-CN" {
		t.Fatal("legacy top-level language was not migrated")
	}
	if code := importPreferencesRequest(t, "old-settings.json", []byte(`{"appearance":{"hideStatusBar":false}}`)); code != 0 || model.Conf.Lang != "zh-CN" {
		t.Fatal("appearance without a language changed the current language")
	}
}
