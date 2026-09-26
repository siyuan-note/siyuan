package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentInstructionsSync(t *testing.T) {
	setupAppearancePackagesTest(t)
	file := util.AgentInstructionsPath()
	writeAppearanceTestFile(t, file, "Workspace preferences")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if ignored, err := syncPathFilter(util.DataDir, info, file); err != nil || ignored {
		t.Fatalf("instructions excluded from sync: %v %v", ignored, err)
	}
	_, matcher := mustSyncIgnoreRules(t)
	if matcher.MatchesPath("/ai/AGENTS.md") {
		t.Fatal("built-in ignore excludes instructions")
	}
	writeAppearanceTestFile(t, filepath.Join(util.DataDir, syncIgnoreRulePath), "/ai/AGENTS.md\n")
	invalidateSyncIgnoreRules(filepath.Join(util.DataDir, syncIgnoreRulePath))
	_, matcher = mustSyncIgnoreRules(t)
	if !matcher.MatchesPath("/ai/AGENTS.md") {
		t.Fatal("user ignore rule must remain effective")
	}
}
