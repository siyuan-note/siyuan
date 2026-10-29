// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"runtime"
	"strings"

	shellquote "github.com/kballard/go-shellquote"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func migratePandocConfig(export *conf.Export) bool {
	if nil == export {
		return false
	}

	changed := false
	if isPathWithin(filepath.Join(util.TempDir, "pandoc"), export.PandocBin) {
		export.PandocBin = ""
		changed = true
	}

	if params, migrated := removeBuiltinPandocTemplateParam(export.PandocParams); migrated {
		export.PandocParams = params
		changed = true
	}
	return changed
}

func removeBuiltinPandocTemplateParam(params string) (ret string, migrated bool) {
	args, err := shellquote.Split(params)
	if err != nil {
		return params, false
	}

	retArgs := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if "--reference-doc" == arg && i+1 < len(args) && isBuiltinPandocTemplatePath(args[i+1]) {
			i++
			migrated = true
			continue
		}
		if strings.HasPrefix(arg, "--reference-doc=") &&
			isBuiltinPandocTemplatePath(strings.TrimPrefix(arg, "--reference-doc=")) {
			migrated = true
			continue
		}
		retArgs = append(retArgs, arg)
	}
	if !migrated {
		return params, false
	}
	return shellquote.Join(retArgs...), true
}

func hasPandocOption(args []string, option string) bool {
	for _, arg := range args {
		if option == arg || strings.HasPrefix(arg, option+"=") {
			return true
		}
	}
	return false
}

func isBuiltinPandocTemplatePath(templatePath string) bool {
	templatePath = strings.TrimSpace(templatePath)
	if "" == templatePath {
		return false
	}

	candidates := []string{
		filepath.Join(util.WorkingDir, "pandoc-resources", "pandoc-template.docx"),
		filepath.Join(util.WorkingDir, "pandoc", "pandoc-resources", "pandoc-template.docx"),
	}
	for _, candidate := range candidates {
		if sameFilePath(candidate, templatePath) {
			return true
		}
	}

	normalized := strings.ToLower(strings.ReplaceAll(templatePath, "\\", "/"))
	parts := strings.Split(normalized, "/")
	for i, part := range parts {
		if strings.HasPrefix(part, "89c2a984.siyuan_") && strings.HasSuffix(part, "__1qfd3tsw4ngc2") {
			return strings.Join(parts[i+1:], "/") ==
				"app/resources/pandoc-resources/pandoc-template.docx"
		}
	}
	return false
}

func sameFilePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if "windows" == runtime.GOOS {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func isPathWithin(root, target string) bool {
	if "" == root || "" == target {
		return false
	}
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil {
		return false
	}
	return "." == rel || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
