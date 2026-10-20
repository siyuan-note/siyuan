package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfMigrationDeprecatedDocxTemplate(t *testing.T) {
	prepareConfConsistencyTest(t)
	previousStore := util.ISMicrosoftStore
	util.ISMicrosoftStore = false
	t.Cleanup(func() { util.ISMicrosoftStore = previousStore })
	file := filepath.Join(t.TempDir(), "legacy template.docx")
	if err := os.WriteFile(file, []byte("template"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, quoted := range []bool{false, true} {
		for _, existing := range []bool{false, true} {
			template := file
			if quoted {
				template = `"` + file + `"`
			}
			params := "--wrap=none"
			if existing {
				params += " --reference-doc existing.docx"
			}
			raw, err := json.Marshal(map[string]any{"confVersion": 3, "export": map[string]string{
				"docxTemplate": template, "pandocParams": params,
			}})
			if err != nil {
				t.Fatal(err)
			}
			original := bytes.Clone(raw)
			config := loadConfFixture(t, string(raw))
			if !applyConfMigrations(config, raw) || config.ConfVersion != CurrentConfVersion {
				t.Fatal("legacy template migration did not finish")
			}
			want := params
			if !existing && !quoted {
				want += ` --reference-doc "` + file + `"`
			}
			if config.Export.Load().PandocParams != want || !bytes.Equal(raw, original) {
				t.Fatalf("template parameters lost: %q, want %q", config.Export.Load().PandocParams, want)
			}
			encoded, err := json.Marshal(config)
			if err != nil || strings.Contains(string(encoded), "docxTemplate") {
				t.Fatalf("deprecated template field persisted: %v", err)
			}
			if applyConfMigrations(config, raw) || config.Export.Load().PandocParams != want {
				t.Fatal("migration was not idempotent")
			}
		}
	}
}
