// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeSettingsEditorCompatibility(t *testing.T) {
	for _, entry := range []struct{ input, want int }{{-1, 64}, {0, 64}, {1, 1}, {63, 63}, {64, 64}, {95, 95}, {5120, 5120}, {5121, 5120}} {
		editor := NewEditor()
		editor.BlockRefDynamicAnchorTextMaxLen = entry.input
		editor.FontSize = 100
		editor.HistoryRetentionDays = 5000
		editor.FloatWindowDelay = new(-1)
		editor.DatabaseAttrShow = new(false)
		editor = NormalizeEditor(editor)
		if editor.BlockRefDynamicAnchorTextMaxLen != entry.want || editor.FontSize != 16 ||
			editor.HistoryRetentionDays != 3650 || *editor.FloatWindowDelay != 0 || *editor.DatabaseAttrShow {
			t.Fatalf("unexpected editor normalization for %d: %+v", entry.input, editor)
		}
		before, _ := json.Marshal(editor)
		after, _ := json.Marshal(NormalizeEditor(editor))
		if string(before) != string(after) {
			t.Fatal("editor normalization is not idempotent")
		}
	}
	if NormalizeEditor(nil).Markdown == nil {
		t.Fatal("missing editor defaults")
	}
}

func TestNormalizeSettingsDatabaseAttrLayout(t *testing.T) {
	for _, entry := range []struct {
		input string
		want  int
	}{
		{`{}`, 1}, {`{"databaseAttrLayout":null}`, 1}, {`{"databaseAttrLayout":0}`, 0},
		{`{"databaseAttrLayout":1}`, 1}, {`{"databaseAttrLayout":2}`, 2},
		{`{"databaseAttrLayout":-1}`, 1}, {`{"databaseAttrLayout":3}`, 1},
	} {
		var editor Editor
		if err := json.Unmarshal([]byte(entry.input), &editor); err != nil {
			t.Fatal(err)
		}
		got := NormalizeEditor(&editor)
		if got.DatabaseAttrLayout == nil || *got.DatabaseAttrLayout != entry.want {
			t.Fatalf("%s: unexpected database field layout: %+v", entry.input, got)
		}
		encoded, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		var saved Editor
		if err = json.Unmarshal(encoded, &saved); err != nil {
			t.Fatal(err)
		}
		if *NormalizeEditor(&saved).DatabaseAttrLayout != entry.want {
			t.Fatal("normalization changed the saved preference")
		}
	}
	if *NewEditor().DatabaseAttrLayout != 1 || *NormalizeEditor(nil).DatabaseAttrLayout != 1 {
		t.Fatal("new and missing editor settings must use row-first two columns")
	}
}

func TestNormalizeSettingsFileTreeAndSearch(t *testing.T) {
	fileTree := NormalizeFileTree(&FileTree{CloseTabsOnStart: true, ShorthandSavePath: "notes", MaxOpenTabCount: 99})
	if *fileTree.TabStartupMode != 2 || !fileTree.CloseTabsOnStart || fileTree.ShorthandSavePath != "/notes" ||
		fileTree.MaxOpenTabCount != 32 || fileTree.MaxListCount != 512 || fileTree.LargeFileWarningSize != 8 ||
		!*fileTree.CreateDocAtTop || fileTree.BoxDocEnabled {
		t.Fatalf("unexpected file tree normalization: %+v", fileTree)
	}
	for _, entry := range []struct{ input, want int }{{-1, 64}, {0, 64}, {1, 32}, {31, 32}, {32, 32}, {128, 128}} {
		search := NormalizeSearch(&Search{Limit: entry.input, HanSensitive: new(false), CustomBlock: new(false)})
		if search.Limit != entry.want || search.BacklinkMentionKeywordsLimit != 512 ||
			search.HanSensitiveVal() || search.CustomBlockEnabled() || !search.MindmapEnabled() || search.MindmapItemEnabled() {
			t.Fatalf("unexpected search normalization for %d: %+v", entry.input, search)
		}
		before, _ := json.Marshal(search)
		after, _ := json.Marshal(NormalizeSearch(search))
		if string(before) != string(after) {
			t.Fatal("search normalization is not idempotent")
		}
	}
}

func TestNormalizeSettingsCloseWindowOnLastTab(t *testing.T) {
	for _, input := range []string{`{}`, `{"closeWindowOnLastTabClosed":null}`, `{"closeWindowOnLastTabClosed":true}`, `{"closeWindowOnLastTabClosed":false}`} {
		var fileTree FileTree
		if err := json.Unmarshal([]byte(input), &fileTree); err != nil {
			t.Fatal(err)
		}
		got := NormalizeFileTree(&fileTree)
		want := !strings.Contains(input, "false")
		if got.CloseWindowOnLastTabClosed == nil || *got.CloseWindowOnLastTabClosed != want {
			t.Fatalf("%s: unexpected last-tab close preference: %+v", input, got)
		}
		if *NormalizeFileTree(got).CloseWindowOnLastTabClosed != want {
			t.Fatal("normalization changed the saved preference")
		}
	}
	if !*NewFileTree().CloseWindowOnLastTabClosed || !*NormalizeFileTree(nil).CloseWindowOnLastTabClosed {
		t.Fatal("new and missing settings must enable last-tab closing")
	}
}

func TestNormalizeSettingsFlashcard(t *testing.T) {
	for _, weight := range []string{"bad", "NaN", "+Inf"} {
		weights := strings.Split(DefaultFSRSWeights(), ",")
		weights[0] = weight
		flashcard, warning := NormalizeFlashcard(&Flashcard{Weights: strings.Join(weights, ","), RequestRetention: 2, MaximumInterval: -1})
		if warning == "" || flashcard.Weights != DefaultFSRSWeights() || flashcard.RequestRetention != NewFlashcard().RequestRetention ||
			flashcard.MaximumInterval != NewFlashcard().MaximumInterval || flashcard.NewCardLimit != 0 || flashcard.ReviewCardLimit != 0 {
			t.Fatalf("unexpected flashcard normalization: %+v, %s", flashcard, warning)
		}
		if _, warning = NormalizeFlashcard(flashcard); warning != "" {
			t.Fatal("normalized weights remain invalid")
		}
	}
	flashcard, warning := NormalizeFlashcard(NewFlashcard())
	if warning != "" || flashcard.Weights != DefaultFSRSWeights() {
		t.Fatal("valid weights changed")
	}
}
