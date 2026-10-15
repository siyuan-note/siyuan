package conf

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfigurationDefaultsAndNormalizationArePure(t *testing.T) {
	previous := util.MarkdownSettings.Load()
	previousSingle, previousLarge := util.UseSingleLineSave.Load(), util.LargeFileWarningSize.Load()
	t.Cleanup(func() {
		util.MarkdownSettings.Store(previous)
		util.UseSingleLineSave.Store(previousSingle)
		util.LargeFileWarningSize.Store(previousLarge)
	})
	construct := func() []any {
		return []any{NewEditor(), NewFileTree(), NewAPI(), NewAI(), NewSystem(), NewAppearance(), NewSync(),
			NewExport(), NewSearch(), NewFlashcard(), NewRepo(), NewOCR(), NewPublish(), NewBazaar(), NewSnpt(),
			NewSecrets(), NewVariables(), NewOIDC(), NewGraph(), NewStat(), NewTag(), NewNotebookCrypto()}
	}
	before, err := json.Marshal(construct())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SIYUAN_OPENAI_API_KEY", "environment-key")
	t.Setenv("SIYUAN_OPENAI_API_MODEL", "environment-model")
	t.Setenv("SIYUAN_OPENAI_AGENT_TIMEOUT", "150")
	markdown := util.NewMarkdown()
	markdown.InlineMath = false
	util.MarkdownSettings.Store(markdown)
	util.UseSingleLineSave.Store(!util.DefaultUseSingleLineSave)
	util.LargeFileWarningSize.Store(999)
	after, err := json.Marshal(construct())
	if err != nil || string(before) != string(after) {
		t.Fatal("defaults depend on mutable globals, environment or randomness")
	}
	first := &AI{MCP: &MCP{Servers: []MCPServer{{Name: "fixture", Type: "stdio", Command: "fixture"}}}}
	second := &AI{MCP: &MCP{Servers: []MCPServer{{Name: "fixture", Type: "stdio", Command: "fixture"}}}}
	if !reflect.DeepEqual(NormalizeAI(first), NormalizeAI(second)) {
		t.Fatal("normalization depends on randomness")
	}
}

func TestExportModeMigrationIsSeparateFromNormalization(t *testing.T) {
	for _, mode := range []int{0, 1, 5} {
		export := NewExport()
		export.BlockRefMode = mode
		if NormalizeExport(export).BlockRefMode != mode {
			t.Fatal("daily normalization ran a version migration")
		}
		if !MigrateExportBlockRefMode(export) || export.BlockRefMode != 4 || MigrateExportBlockRefMode(export) {
			t.Fatal("mode migration is not idempotent")
		}
	}
}
