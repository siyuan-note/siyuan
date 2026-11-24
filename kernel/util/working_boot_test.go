// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import "testing"

func TestBootStageDetailsAllowsOnlyPublicStages(t *testing.T) {
	previousLang, previousLangs := Lang, Langs
	t.Cleanup(func() { Lang, Langs = previousLang, previousLangs })
	Lang = "test"
	Langs = map[string]map[int]string{
		"test": {int(BootStageSyncing): "Localized sync stage", 92: "Internal details %s"},
	}

	if got := BootStageSyncing.details(); got != "Localized sync stage" {
		t.Fatalf("unexpected public stage: %q", got)
	}
	if got := BootStageStarting.details(); got != "Booting kernel..." {
		t.Fatalf("unexpected fallback stage: %q", got)
	}
	if got := BootStage(92).details(); got != "" {
		t.Fatalf("unsupported stage returned %q", got)
	}
}

func TestBootWorkCounterChangesAtSamePercentage(t *testing.T) {
	previousProgress, previousDetails := GetBootProgressDetails()
	t.Cleanup(func() {
		bootProgress.Store(previousProgress)
		bootDetailsLock.Lock()
		bootDetails = previousDetails
		bootDetailsLock.Unlock()
	})
	bootProgress.Store(40)

	UpdateBootProgress(0, BootStageIndexingDocuments, 7, 500)
	progress, first := GetBootProgressDetails()
	UpdateBootProgress(0, BootStageIndexingDocuments, 8, 500)
	nextProgress, next := GetBootProgressDetails()
	if progress != 40 || nextProgress != progress || first == next {
		t.Fatalf("work counter did not advance at the same percentage: %d %q, %d %q", progress, first, nextProgress, next)
	}
}
