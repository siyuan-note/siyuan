// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// WidgetSearchResult 描述了挂件搜索结果。
type WidgetSearchResult struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func SearchWidget(keyword string) (ret []*WidgetSearchResult) {
	ret = []*WidgetSearchResult{}
	widgetsDirPath := filepath.Join(util.DataDir, "widgets")
	widgetsDir, err := os.ReadDir(widgetsDirPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", widgetsDirPath, err)
		return
	}

	var widgets []*bazaar.Package
	for _, dir := range widgetsDir {
		if !util.IsDirRegularOrSymlink(dir) {
			continue
		}
		dirName := dir.Name()
		if strings.HasPrefix(dirName, ".") {
			continue
		}

		widget, _ := bazaar.ParsePackageJSON(filepath.Join(widgetsDirPath, dirName, "widget.json"))
		if !bazaar.IsValidInstalledPackage(widget, dirName) {
			continue
		}

		widgets = append(widgets, widget)
	}

	widgets = bazaar.FilterPackages(widgets, keyword)
	for _, widget := range widgets {
		b := &WidgetSearchResult{
			Name:    bazaar.GetPreferredLocaleString(widget.DisplayName, widget.Name),
			Content: widget.Name,
		}
		ret = append(ret, b)
	}

	return
}
