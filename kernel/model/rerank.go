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

import "github.com/siyuan-note/siyuan/kernel/util"

// defaultRerankCandidateCount 向量召回后默认送入重排的候选文档数，与 conf.defaultRerank 保持一致。
const defaultRerankCandidateCount = 30

// isRerankEnabled 判断重排是否可用：配置已开启且填了 APIKey。语义搜索在召回后会据此决定是否走重排。
func isRerankEnabled() bool {
	confAISnapshot := Conf.LoadAI()

	return !util.IsDisabledFeature("ai") && nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && len(confAISnapshot.Rerank.APIKey) > 0
}

func rerankKey() string {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && "" != confAISnapshot.Rerank.APIKey {
		return confAISnapshot.Rerank.APIKey
	}
	return ""
}

func rerankEndpoint() string {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && "" != confAISnapshot.Rerank.Endpoint {
		return confAISnapshot.Rerank.Endpoint
	}
	return ""
}

func rerankModel() string {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && "" != confAISnapshot.Rerank.Name {
		return confAISnapshot.Rerank.Name
	}
	return ""
}

func rerankRequestFormat() util.RerankRequestFormat {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled {
		return confAISnapshot.Rerank.RequestFormat
	}
	return util.RerankRequestFormatCohere
}

func rerankTimeout() int {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && 0 < confAISnapshot.Rerank.Timeout {
		return confAISnapshot.Rerank.Timeout
	}
	return 30
}

// rerankCandidateCount 返回向量召回后送入重排的候选文档数。Normalize 已保证落在 [5,100]，这里做兜底。
func rerankCandidateCount() int {
	confAISnapshot := Conf.LoadAI()

	if nil != confAISnapshot.Rerank && confAISnapshot.Rerank.Enabled && 0 < confAISnapshot.Rerank.CandidateCount {
		return confAISnapshot.Rerank.CandidateCount
	}
	return defaultRerankCandidateCount
}
