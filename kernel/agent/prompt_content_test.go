// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestSystemPromptRequiresSourceContentReads(t *testing.T) {
	for _, instruction := range []string{
		"including a bare block ID",
		"read its actual content with block.get or block.get_kramdown",
		"block.get may truncate long block content",
		"block.get on a document block returns its title, not its body",
		"visible blocks only when relevant",
		"not a substitute for block.get or block.get_kramdown",
		"Never switch tools to bypass notebook scope, ambiguity or access errors",
		"first read the current block with block.get_kramdown",
		"entire content, not a delta",
		"block IDs supplied by the user, present in turn context, or actually returned by a tool call",
		"A known ID permits linking, not claims about unread content",
	} {
		if !strings.Contains(systemPrompt, instruction) {
			t.Errorf("missing source-content instruction %q", instruction)
		}
	}
}

func TestSourceContentPromptRespectsAvailableCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name  string
		tools []string
	}{
		{"none", nil},
		{"block", []string{"block"}},
		{"sql", []string{"sql"}},
		{"block_sql", []string{"block", "sql"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			set := &capabilitySet{registrations: map[string]*capabilityRegistration{}}
			for _, name := range tc.tools {
				set.registrations[name] = &capabilityRegistration{ModelName: name}
			}
			prompt := filterSystemPromptByCapabilities(systemPrompt, set)
			for _, name := range []string{"block", "sql"} {
				if !set.hasModelName(name) && strings.Contains(prompt, name+".") {
					t.Errorf("prompt instructs an unavailable %s capability", name)
				}
			}
			if set.hasModelName("block") && !strings.Contains(prompt, "including a bare block ID") {
				t.Fatal("content-reading guidance must not depend on unrelated tools")
			}
			if !strings.Contains(prompt, "request the needed content") || !strings.Contains(prompt, "present in turn context") {
				t.Fatal("content-unavailable fallback and known-ID links must survive capability filtering")
			}
		})
	}
}

func TestTurnContextIdentifiesPreviewsAndPrioritizesReads(t *testing.T) {
	var references []Reference
	if err := json.Unmarshal([]byte(`[{"id":"20261105000000-ref0001","title":"An incomplete anchor..."}]`), &references); err != nil {
		t.Fatal(err)
	}
	editor := &EditorContext{ActiveDocID: "document", FocusedBlockID: "focused", SelectedBlockIDs: []string{"selected"}}
	for i := range maxVisibleBlockIDs + 1 {
		editor.VisibleBlockIDs = append(editor.VisibleBlockIDs, fmt.Sprintf("visible-%d", i))
	}
	for _, set := range []*capabilitySet{nil, {registrations: map[string]*capabilityRegistration{}}} {
		content := buildUserMessageContent("summarize this", references, editor, set)
		for _, want := range []string{"anchor text/a preview, not the block's full content", "An incomplete anchor...", "20261105000000-ref0001", "showing first 50 of 51", "focused", "selected"} {
			if !strings.Contains(content, want) {
				t.Errorf("missing context %q: %s", want, content)
			}
		}
		if strings.Contains(content, "visible-50") || !strings.HasSuffix(content, "summarize this") {
			t.Fatal("visible limit or original user message changed")
		}
		if set == nil {
			for _, want := range []string{"fetch actual content before answering", "Prioritize explicitly requested/referenced and selected/focused blocks", "fetch visible blocks only as needed", "block.get returns only the document title"} {
				if !strings.Contains(content, want) {
					t.Errorf("missing context reading guidance %q", want)
				}
			}
		} else if strings.Contains(content, "block.get") {
			t.Fatal("turn context directs the model to an unavailable block tool")
		}
	}
}
