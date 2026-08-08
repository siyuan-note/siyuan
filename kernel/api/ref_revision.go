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

package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/model"
)

type backlinkPathResponse struct {
	*model.Path
	Revision string `json:"revision"`
}

type backlinkContextResponse struct {
	ID         string             `json:"id"`
	DOM        string             `json:"dom"`
	BlockPaths []*model.BlockPath `json:"blockPaths"`
	Expand     bool               `json:"expand"`
	Revision   string             `json:"revision"`
}

type backlinkListResponse struct {
	Unchanged     bool                    `json:"unchanged"`
	Revision      string                  `json:"revision"`
	Backlinks     []*backlinkPathResponse `json:"backlinks"`
	LinkRefsCount int                     `json:"linkRefsCount"`
	Backmentions  []*backlinkPathResponse `json:"backmentions"`
	MentionsCount int                     `json:"mentionsCount"`
	K             string                  `json:"k"`
	MK            string                  `json:"mk"`
	Box           string                  `json:"box"`
}

type backlinkContextResult struct {
	Unchanged    bool                       `json:"unchanged"`
	Revision     string                     `json:"revision"`
	Backlinks    []*backlinkContextResponse `json:"backlinks"`
	Backmentions []*backlinkContextResponse `json:"backmentions"`
	Keywords     []string                   `json:"keywords"`
}

func newBacklinkPathResponses(paths []*model.Path) (ret []*backlinkPathResponse) {
	ret = make([]*backlinkPathResponse, 0, len(paths))
	for _, item := range paths {
		ret = append(ret, &backlinkPathResponse{
			Path: item,
			Revision: hashBacklinkRevision("bi1:", struct {
				ID       string
				Box      string
				Name     string
				Number   string
				HPath    string
				Type     string
				NodeType string
				SubType  string
				Depth    int
				Count    int
				Folded   bool
			}{
				item.ID,
				item.Box,
				item.Name,
				item.Number,
				item.HPath,
				item.Type,
				item.NodeType,
				item.SubType,
				item.Depth,
				item.Count,
				item.Folded,
			}),
		})
	}
	return
}

func backlinkPathRevisions(items []*backlinkPathResponse) (ret []string) {
	ret = make([]string, 0, len(items))
	for _, item := range items {
		ret = append(ret, item.Revision)
	}
	return
}

func canonicalBacklinkKeywords(keywords []string) []string {
	ret := append([]string{}, keywords...)
	sort.Slice(ret, func(i, j int) bool {
		if len(ret[i]) == len(ret[j]) {
			return ret[i] < ret[j]
		}
		return len(ret[i]) > len(ret[j])
	})
	return ret
}

func newBacklinkContextResponses(backlinks []*model.Backlink) (ret []*backlinkContextResponse) {
	ret = make([]*backlinkContextResponse, 0, len(backlinks))
	for _, item := range backlinks {
		response := &backlinkContextResponse{
			ID:         item.ID,
			DOM:        item.DOM,
			BlockPaths: item.BlockPaths,
			Expand:     item.Expand,
		}
		response.Revision = hashBacklinkRevision("bci1:", struct {
			ID         string
			DOM        string
			BlockPaths []*model.BlockPath
			Expand     bool
		}{response.ID, response.DOM, response.BlockPaths, response.Expand})
		ret = append(ret, response)
	}
	return
}

func hashBacklinkRevision(prefix string, value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return prefix
	}
	sum := sha256.Sum256(data)
	return prefix + hex.EncodeToString(sum[:])
}

func countBacklinkPaths(paths []*model.Path) (ret int) {
	for _, item := range paths {
		ret += item.Count
	}
	return
}
