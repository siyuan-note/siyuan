// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if matcher.MatchesPath("/storage/ai/AGENTS.md") {
		t.Fatal("built-in ignore excludes instructions")
	}
	writeAppearanceTestFile(t, filepath.Join(util.DataDir, syncIgnoreRulePath), "/storage/ai/AGENTS.md\n")
	invalidateSyncIgnoreRules(filepath.Join(util.DataDir, syncIgnoreRulePath))
	_, matcher = mustSyncIgnoreRules(t)
	if !matcher.MatchesPath("/storage/ai/AGENTS.md") {
		t.Fatal("user ignore rule must remain effective")
	}
	if PathsAffectSync(file) {
		t.Fatal("ignored canonical instructions scheduled synchronization")
	}
	// Migration removes the legacy source. Its deletion still needs upload even
	// when the new file is excluded by the user's current ignore rules.
	if !PathsAffectSync(file, util.LegacyAgentInstructionsPath()) {
		t.Fatal("legacy deletion omitted from synchronization")
	}
}
