// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"sync"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var md2HTMLLutePool sync.Pool

func getMd2HTMLLuteFromPool() *lute.Lute {
	v := md2HTMLLutePool.Get()
	if v == nil {
		e := util.NewLute()
		// 与 Conf 解耦
		e.SetCodeSyntaxHighlightLineNum(false)
		e.SetChineseParagraphBeginningSpace(false)
		e.SetProtyleMarkNetImg(false)
		e.SetSpellcheck(false)
		e.SetFootnotes(true)
		enableLuteInlineSyntax(e)
		return e
	}
	return v.(*lute.Lute)
}

func MarkdownToProtylePreviewHTML(markdown string) string {
	eng := getMd2HTMLLuteFromPool()
	defer md2HTMLLutePool.Put(eng)

	tree := parse.Parse("", []byte(markdown), eng.ParseOptions)
	if nil == tree || nil == tree.Root {
		return ""
	}
	return eng.ProtylePreview(tree, eng.RenderOptions, eng.ParseOptions)
}

func MarkdownToMarkdownStrHTML(markdown string) string {
	eng := getMd2HTMLLuteFromPool()
	defer md2HTMLLutePool.Put(eng)
	return eng.MarkdownStr("", markdown)
}
