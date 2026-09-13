// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestWriteBlockWriteResult(t *testing.T) {
	originalOutputFormat := outputFormat
	defer func() {
		outputFormat = originalOutputFormat
	}()

	const id = "20260818000000-abcdefg"
	var output bytes.Buffer
	outputFormat = "table"
	if err := writeBlockWriteResult(&output, id); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(output.String()); got != id {
		t.Fatalf("unexpected table output: got %q, want %q", got, id)
	}

	output.Reset()
	outputFormat = "json"
	if err := writeBlockWriteResult(&output, id); err != nil {
		t.Fatal(err)
	}
	result := map[string]string{}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["id"] != id {
		t.Fatalf("unexpected JSON output: got %q, want %q", result["id"], id)
	}
}

func TestWriteBlockWriteResultRejectsEmptyID(t *testing.T) {
	if err := writeBlockWriteResult(&bytes.Buffer{}, ""); err == nil {
		t.Fatal("expected empty block ID to fail")
	}
}

func TestBlockDeleteRejectsMissingBlock(t *testing.T) {
	previous := dryRun
	t.Cleanup(func() { dryRun = previous })
	for _, dry := range []bool{false, true} {
		dryRun = dry
		command := &cobra.Command{}
		command.Flags().String("id", "20260913000000-missing", "")
		if err := blockDeleteCmd.RunE(command, nil); err == nil || !strings.Contains(err.Error(), "block not found") {
			t.Fatalf("missing block accepted (dry-run=%v): %v", dry, err)
		}
	}
}
