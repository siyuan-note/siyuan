// SiYuan - Build Your Eternal Digital Garden
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
	"bytes"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ChatGPTSummary(ids []string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	msg := getBlocksContent(ids)
	ret = util.ChatGPTSummary(msg, Conf.Lang)
	return
}

func ChatGPTTranslate(ids []string, lang string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	msg := getBlocksContent(ids)
	ret = util.ChatGPTTranslate(msg, lang)
	return
}

func ChatGPTContinueWriteBlocks(ids []string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	msg := getBlocksContent(ids)
	ret, _ = util.ChatGPTContinueWrite(msg, nil)
	return
}

func ChatGPT(msg string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	return util.ChatGPT(msg)
}

func isOpenAIAPIEnabled() bool {
	if "" == util.OpenAIAPIKey {
		util.PushMsg(Conf.Language(193), 5000)
		return false
	}
	return true
}

func getBlocksContent(ids []string) string {
	sqlBlocks := sql.GetBlocks(ids)
	buf := bytes.Buffer{}
	for _, sqlBlock := range sqlBlocks {
		buf.WriteString(sqlBlock.Content)
		buf.WriteString("\n\n")
	}

	return buf.String()
}
