// SiYuan - Refactor your thinking
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
