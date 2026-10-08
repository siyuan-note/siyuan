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
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestTemplateCommandsAcceptDotPrefixedNames(t *testing.T) {
	previous, previousDryRun := util.DataDir, dryRun
	util.DataDir, dryRun = t.TempDir(), false
	t.Cleanup(func() { util.DataDir, dryRun = previous, previousDryRun })
	base := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatal(err)
	}
	for _, command := range []*cobra.Command{templateGetCmd, templateRenderCmd, templateRemoveCmd} {
		pathFlag := command.Flags().Lookup("path")
		previousPath, previousChanged := pathFlag.Value.String(), pathFlag.Changed
		t.Cleanup(func() { _ = pathFlag.Value.Set(previousPath); pathFlag.Changed = previousChanged })
	}
	idFlag := templateRenderCmd.Flags().Lookup("id")
	previousID, previousChanged := idFlag.Value.String(), idFlag.Changed
	t.Cleanup(func() { _ = idFlag.Value.Set(previousID); idFlag.Changed = previousChanged })
	if err := templateRenderCmd.Flags().Set("id", "invalid-block"); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"..foo.md", filepath.Join(base, "..foo.md")} {
		if err := os.WriteFile(filepath.Join(base, "..foo.md"), []byte("template"), 0644); err != nil {
			t.Fatal(err)
		}
		for _, command := range []*cobra.Command{templateGetCmd, templateRenderCmd, templateRemoveCmd} {
			if err := command.Flags().Set("path", path); err != nil {
				t.Fatal(err)
			}
			err := command.RunE(command, nil)
			if command == templateRenderCmd {
				if !errors.Is(err, model.ErrTreeNotFound) {
					t.Fatalf("render did not reach block lookup for %q: %v", path, err)
				}
			} else if err != nil {
				t.Fatalf("%s %q: %v", command.Name(), path, err)
			}
		}
	}
	for _, command := range []*cobra.Command{templateGetCmd, templateRenderCmd, templateRemoveCmd} {
		for _, path := range []string{"", ".", "../outside.md"} {
			if err := command.Flags().Set("path", path); err != nil {
				t.Fatal(err)
			}
			if err := command.RunE(command, nil); err == nil || errors.Is(err, model.ErrTreeNotFound) {
				t.Fatalf("%s accepted escaped path %q: %v", command.Name(), path, err)
			}
		}
	}
}

func TestWriteTemplateSearchResults(t *testing.T) {
	results := []*model.TemplateSearchResult{{
		Content:      "Daily report",
		RelativePath: "group/daily.md",
		Path:         "/data/templates/group/daily.md",
	}}
	var output bytes.Buffer
	if err := writeTemplateSearchResults(&output, results); err != nil {
		t.Fatal(err)
	}

	text := output.String()
	for _, expected := range []string{"NAME", "RELATIVE_PATH", "PATH", "group/daily.md", results[0].Path, "1 template(s)"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("template search output missing %q: %q", expected, text)
		}
	}
}
