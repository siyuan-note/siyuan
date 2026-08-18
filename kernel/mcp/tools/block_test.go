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
	"testing"
)

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
