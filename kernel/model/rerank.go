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

// defaultRerankCandidateCount 向量召回后默认送入重排的候选文档数，与 conf.defaultRerank 保持一致。
const defaultRerankCandidateCount = 30

// isRerankEnabled 判断重排是否可用：配置已开启且填了 APIKey。语义搜索在召回后会据此决定是否走重排。
func isRerankEnabled() bool {
	return nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && len(Conf.AI.Rerank.APIKey) > 0
}

func rerankKey() string {
	if nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && "" != Conf.AI.Rerank.APIKey {
		return Conf.AI.Rerank.APIKey
	}
	return ""
}

func rerankEndpoint() string {
	if nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && "" != Conf.AI.Rerank.Endpoint {
		return Conf.AI.Rerank.Endpoint
	}
	return ""
}

func rerankModel() string {
	if nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && "" != Conf.AI.Rerank.Name {
		return Conf.AI.Rerank.Name
	}
	return ""
}

func rerankTimeout() int {
	if nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && 0 < Conf.AI.Rerank.Timeout {
		return Conf.AI.Rerank.Timeout
	}
	return 30
}

// rerankCandidateCount 返回向量召回后送入重排的候选文档数。Normalize 已保证落在 [5,100]，这里做兜底。
func rerankCandidateCount() int {
	if nil != Conf.AI.Rerank && Conf.AI.Rerank.Enabled && 0 < Conf.AI.Rerank.CandidateCount {
		return Conf.AI.Rerank.CandidateCount
	}
	return defaultRerankCandidateCount
}
