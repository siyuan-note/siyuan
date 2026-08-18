// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"path/filepath"
	"testing"

	shellquote "github.com/kballard/go-shellquote"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMigratePandocConfig(t *testing.T) {
	oldTempDir, oldWorkingDir := util.TempDir, util.WorkingDir
	util.TempDir, util.WorkingDir = t.TempDir(), t.TempDir()
	defer func() {
		util.TempDir, util.WorkingDir = oldTempDir, oldWorkingDir
	}()

	export := &conf.Export{
		PandocBin: filepath.Join(util.TempDir, "pandoc", "bin", "pandoc.exe"),
		PandocParams: `--toc --reference-doc "C:\Program Files\WindowsApps\89C2A984.SiYuan_3.5.5.0_x64__1qfd3tsw4ngc2\app\resources\pandoc-resources\pandoc-template.docx" ` +
			`--metadata title=test`,
	}
	if !migratePandocConfig(export) {
		t.Fatal("expected Pandoc configuration migration")
	}
	if "" != export.PandocBin {
		t.Fatalf("legacy built-in Pandoc path was not cleared: %q", export.PandocBin)
	}

	args, err := shellquote.Split(export.PandocParams)
	if err != nil {
		t.Fatalf("split migrated Pandoc parameters failed: %v", err)
	}
	expected := []string{"--toc", "--metadata", "title=test"}
	if len(args) != len(expected) {
		t.Fatalf("unexpected migrated Pandoc parameters: %#v", args)
	}
	for i, arg := range args {
		if expected[i] != arg {
			t.Fatalf("unexpected migrated Pandoc argument at %d: %q", i, arg)
		}
	}
}

func TestMigratePandocConfigPreservesCustomPaths(t *testing.T) {
	oldTempDir, oldWorkingDir := util.TempDir, util.WorkingDir
	util.TempDir, util.WorkingDir = t.TempDir(), t.TempDir()
	defer func() {
		util.TempDir, util.WorkingDir = oldTempDir, oldWorkingDir
	}()

	export := &conf.Export{
		PandocBin:    filepath.Join(t.TempDir(), "pandoc.exe"),
		PandocParams: `--reference-doc "data/storage/template.docx" --toc`,
	}
	if migratePandocConfig(export) {
		t.Fatalf("custom Pandoc configuration was unexpectedly migrated: %#v", export)
	}
}

func TestRemoveBuiltinPandocTemplateParam(t *testing.T) {
	oldWorkingDir := util.WorkingDir
	util.WorkingDir = t.TempDir()
	defer func() {
		util.WorkingDir = oldWorkingDir
	}()

	currentTemplate := filepath.Join(util.WorkingDir, "pandoc-resources", "pandoc-template.docx")
	tests := []struct {
		name     string
		params   string
		migrated bool
	}{
		{
			name:     "current built-in template",
			params:   shellquote.Join("--reference-doc", currentTemplate, "--toc"),
			migrated: true,
		},
		{
			name: "Microsoft Store equals syntax",
			params: `--reference-doc="C:\Program Files\WindowsApps\89C2A984.SiYuan_3.5.6.0_x64__1qfd3tsw4ngc2` +
				`\app\resources\pandoc-resources\pandoc-template.docx"`,
			migrated: true,
		},
		{
			name:     "relative template",
			params:   `--reference-doc "data/storage/template.docx"`,
			migrated: false,
		},
		{
			name:     "custom absolute template",
			params:   shellquote.Join("--reference-doc", filepath.Join(t.TempDir(), "template.docx")),
			migrated: false,
		},
		{
			name:     "malformed parameters",
			params:   `--reference-doc "unterminated`,
			migrated: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			params, migrated := removeBuiltinPandocTemplateParam(test.params)
			if test.migrated != migrated {
				t.Fatalf("unexpected migration result: %v, params: %q", migrated, params)
			}
			if !test.migrated && test.params != params {
				t.Fatalf("parameters changed without migration: %q", params)
			}
			if test.migrated && hasPandocOption(mustSplitPandocParams(t, params), "--reference-doc") {
				t.Fatalf("built-in reference document parameter was not removed: %q", params)
			}
		})
	}
}

func TestHasPandocOption(t *testing.T) {
	if !hasPandocOption([]string{"--reference-doc", "template.docx"}, "--reference-doc") {
		t.Fatal("separate Pandoc option was not detected")
	}
	if !hasPandocOption([]string{"--reference-doc=template.docx"}, "--reference-doc") {
		t.Fatal("equals-style Pandoc option was not detected")
	}
	if hasPandocOption([]string{"--reference-document", "template.docx"}, "--reference-doc") {
		t.Fatal("unrelated Pandoc option was detected")
	}
}

func mustSplitPandocParams(t *testing.T, params string) []string {
	t.Helper()
	args, err := shellquote.Split(params)
	if err != nil {
		t.Fatalf("split Pandoc parameters failed: %v", err)
	}
	return args
}
