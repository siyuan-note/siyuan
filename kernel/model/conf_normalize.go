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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NormalizeAppConf 对全部持久化配置段执行规范化，导入设置等整体写入路径使用。
func NormalizeAppConf(c *AppConf) {
	normalizeAppConf(c)
}

// normalizeAppConf 对全部持久化配置段执行规范化，启动加载、设置重置和写入路径共用同一组规则。
// 返回闪卡权重修复原因，由调用方决定是否提示用户。
func normalizeAppConf(c *AppConf) (flashcardWarning string) {
	c.Appearance.Store(conf.NormalizeAppearance(c.Appearance.Load(), util.IsMobileContainer()))
	c.UILayout.Store(conf.NormalizeUILayout(c.UILayout.Load()))
	c.Keymap.Store(conf.NormalizeKeymap(c.Keymap.Load()))
	c.FileTree.Store(conf.NormalizeFileTree(c.FileTree.Load()))
	c.Tag.Store(conf.NormalizeTag(c.Tag.Load()))
	c.Editor.Store(conf.NormalizeEditor(c.Editor.Load()))
	c.Export.Store(conf.NormalizeExport(c.Export.Load()))
	c.Graph.Store(conf.NormalizeGraph(c.Graph.Load()))
	c.System.Store(conf.NormalizeSystem(c.System.Load()))
	c.Onboarding.Store(conf.NormalizeOnboarding(c.Onboarding.Load()))
	c.Snippet.Store(conf.NormalizeSnippet(c.Snippet.Load()))
	c.Sync.Store(conf.NormalizeSync(c.Sync.Load()))
	c.Api.Store(conf.NormalizeAPI(c.Api.Load()))
	c.Bazaar.Store(conf.NormalizeBazaar(c.Bazaar.Load()))
	c.Publish.Store(conf.NormalizePublish(c.Publish.Load()))
	c.Repo.Store(conf.NormalizeRepo(c.Repo.Load()))
	c.NotebookCrypto = conf.NormalizeNotebookCrypto(c.NotebookCrypto)
	c.Search.Store(conf.NormalizeSearch(c.Search.Load()))
	c.Stat.Store(conf.NormalizeStat(c.Stat.Load()))
	{
		flashcard, warning := conf.NormalizeFlashcard(c.Flashcard.Load())
		c.Flashcard.Store(flashcard)
		flashcardWarning = warning
	}
	c.OCR.Store(conf.NormalizeOCR(c.OCR.Load()))
	c.AI.Store(conf.NormalizeAI(c.AI.Load()))
	c.OIDC = conf.NormalizeOIDC(c.OIDC)
	c.Secrets.Store(conf.NormalizeSecrets(c.Secrets.Load()))
	c.Variables.Store(conf.NormalizeVariables(c.Variables.Load()))
	return
}
