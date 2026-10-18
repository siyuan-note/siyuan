package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfPreferencesPersistPatchAndReset(t *testing.T) {
	prepareConfConsistencyTest(t)
	settingsResetTestEnvironment(t)
	Conf.AI.Load().Agent.StreamingMarkdown = true
	oldStorage := []byte(`{"local-compact-mode":true,"local-menu-mouse-scroll":true,"local-outline":{"keepCurrentExpand":true},"local-pdftheme":{"light":"dark"},"local-mobile-bars":{"autoHide":false},"local-recent-docs":{"type":"updated"},"siyuan-agent-streaming-markdown":true}`)
	if err := os.WriteFile(settingsResetPaths()[1], oldStorage, 0600); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ namespace, patch string }{
		{"appearance", `{"compactMode":true,"menuMouseScroll":true,"outlineKeepCurrentExpand":true,"pdfTheme":{"light":"dark","annoColor":"red"},"mobileBars":{"autoHide":false,"sidebarSwipe":false}}`},
		{"fileTree", `{"recentDocsSort":"updated"}`},
		{"ai", `{"agent":{"streamingMarkdown":true}}`},
		{"appearance", `{"pdfTheme":{"dark":"light"},"mobileBars":{"sidebarButtons":false}}`},
	} {
		if _, err := ApplyConfPatch(item.namespace, []byte(item.patch)); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	reloaded := NewAppConf()
	if err = json.Unmarshal(data, reloaded); err != nil {
		t.Fatal(err)
	}
	appearance := reloaded.Appearance.Load()
	if !appearance.CompactMode || !appearance.MenuMouseScroll || !appearance.OutlineKeepCurrentExpand ||
		appearance.PDFTheme.Light != "dark" || appearance.PDFTheme.Dark != "light" || appearance.PDFTheme.AnnoColor != "red" ||
		*appearance.MobileBars.AutoHide || *appearance.MobileBars.SidebarSwipe || !*appearance.MobileBars.SidebarButtons ||
		reloaded.FileTree.Load().RecentDocsSort != "updated" || !reloaded.AI.Load().Agent.StreamingMarkdown {
		t.Fatal("persisted preferences or partial update preservation changed")
	}
	if err = ResetSettings(); err != nil {
		t.Fatal(err)
	}
	appearance = Conf.Appearance.Load()
	if appearance.CompactMode || appearance.MenuMouseScroll || appearance.OutlineKeepCurrentExpand ||
		appearance.PDFTheme.Light != "light" || appearance.PDFTheme.Dark != "dark" ||
		!*appearance.MobileBars.AutoHide || !*appearance.MobileBars.SidebarSwipe || !*appearance.MobileBars.SidebarButtons ||
		Conf.FileTree.Load().RecentDocsSort != "viewedAt" || !Conf.AI.Load().Agent.StreamingMarkdown {
		t.Fatal("reset must restore appearance and file tree preferences while preserving AI")
	}
	if data, err = os.ReadFile(settingsResetPaths()[1]); err != nil {
		t.Fatal(err)
	}
	var old, stored map[string]any
	if err = json.Unmarshal(oldStorage, &old); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(old, stored) {
		t.Fatal("retired KV keys must not be maintained by settings reset")
	}
}
