// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBlockToolDocumentsSuperBlockSyntax(t *testing.T) {
	description := BlockTool.InputSchema.Properties["data"].Description
	for _, instruction := range []string{
		"{{{col",
		"col is horizontal and row is vertical",
		"data-sb-layout",
		"never data-layout",
		"every child needs an explicit data-type",
	} {
		if !strings.Contains(description, instruction) {
			t.Fatalf("block data description is missing the super-block instruction %q", instruction)
		}
	}
}

func TestMarkdownToBlockDOMCreatesHorizontalSuperBlock(t *testing.T) {
	dom, err := markdownToBlockDOM("{{{col\n\nfirst paragraph\n\nsecond paragraph\n\n}}}")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dom, `data-type="NodeSuperBlock"`) || !strings.Contains(dom, `data-sb-layout="col"`) {
		t.Fatalf("horizontal super-block was not preserved in block DOM: %s", dom)
	}
	if count := strings.Count(dom, `data-type="NodeParagraph"`); count != 2 {
		t.Fatalf("expected two paragraph blocks, got %d: %s", count, dom)
	}
	if strings.Contains(dom, `data-type="NodeHTMLBlock"`) {
		t.Fatalf("super-block children became HTML blocks: %s", dom)
	}
}

func TestBlockWriteSuccess(t *testing.T) {
	const id = "20260818000000-abcdefg"
	result, err := blockWriteSuccess("append", id)
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError || !result.HasStructuredContent() || len(result.Content) != 1 {
		t.Fatalf("unexpected block write result: %#v", result)
	}

	textOutput := &blockWriteOutput{}
	if err = json.Unmarshal([]byte(result.Content[0].Text), textOutput); err != nil {
		t.Fatal(err)
	}
	if textOutput.Action != "append" || textOutput.ID != id {
		t.Fatalf("unexpected text output: %#v", textOutput)
	}

	structuredOutput, ok := result.StructuredContent.(*blockWriteOutput)
	if !ok || structuredOutput.Action != "append" || structuredOutput.ID != id {
		t.Fatalf("unexpected structured output: %#v", result.StructuredContent)
	}
}

func TestBlockWriteSuccessRejectsEmptyID(t *testing.T) {
	result, err := blockWriteSuccess("insert", "")
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatalf("expected empty block ID to fail: %#v", result)
	}
}
