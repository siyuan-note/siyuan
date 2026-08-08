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

package av

import (
	"strings"

	"github.com/88250/lute/ast"
)

const (
	CardCoverSourceContent     = "content"
	cardCoverSourceAssetPrefix = "asset:"
)

// CardCoverPosition 描述卡片封面图片的位置。
type CardCoverPosition struct {
	Image string  `json:"image"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

func CardCoverSource(coverFrom CoverFrom, assetKeyID string) string {
	switch coverFrom {
	case CoverFromContentImage:
		return CardCoverSourceContent
	case CoverFromAssetField:
		if "" != assetKeyID {
			return cardCoverSourceAssetPrefix + assetKeyID
		}
	}
	return ""
}

func IsValidCardCoverSource(source string) bool {
	if CardCoverSourceContent == source {
		return true
	}
	if !strings.HasPrefix(source, cardCoverSourceAssetPrefix) {
		return false
	}
	return ast.IsNodeIDPattern(strings.TrimPrefix(source, cardCoverSourceAssetPrefix))
}

func CardCoverSourceAssetKeyID(source string) string {
	if !strings.HasPrefix(source, cardCoverSourceAssetPrefix) {
		return ""
	}
	return strings.TrimPrefix(source, cardCoverSourceAssetPrefix)
}

func (av *AttributeView) GetCardCoverPosition(itemID, source, image string) (ret *CardCoverPosition) {
	if "" == itemID || "" == source || "" == image {
		return
	}
	sources := av.CardCoverPositions[itemID]
	if nil == sources {
		return
	}
	position := sources[source]
	if nil == position {
		return
	}
	if image != position.Image {
		av.SetCardCoverPosition(itemID, source, nil)
		av.cardCoverPositionsChanged = true
		return
	}
	ret = &CardCoverPosition{Image: position.Image, X: position.X, Y: position.Y}
	return
}

// HasCardCoverPositionChanges 判断渲染期间是否清理了失效的卡片封面位置。
func (av *AttributeView) HasCardCoverPositionChanges() bool {
	return av.cardCoverPositionsChanged
}

// ResetCardCoverPositionChanges 重置卡片封面位置变更标记。
func (av *AttributeView) ResetCardCoverPositionChanges() {
	av.cardCoverPositionsChanged = false
}

func (av *AttributeView) SetCardCoverPosition(itemID, source string, position *CardCoverPosition) {
	if "" == itemID || "" == source {
		return
	}
	if nil == position {
		if sources := av.CardCoverPositions[itemID]; nil != sources {
			delete(sources, source)
			if 0 == len(sources) {
				delete(av.CardCoverPositions, itemID)
				if 0 == len(av.CardCoverPositions) {
					av.CardCoverPositions = nil
				}
			}
		}
		return
	}
	if nil == av.CardCoverPositions {
		av.CardCoverPositions = map[string]map[string]*CardCoverPosition{}
	}
	if nil == av.CardCoverPositions[itemID] {
		av.CardCoverPositions[itemID] = map[string]*CardCoverPosition{}
	}
	av.CardCoverPositions[itemID][source] = &CardCoverPosition{Image: position.Image, X: position.X, Y: position.Y}
}

func (av *AttributeView) CopyCardCoverPositions(srcItemID, destItemID string) {
	sources := av.CardCoverPositions[srcItemID]
	if 0 == len(sources) {
		return
	}
	for source, position := range sources {
		if nil != position {
			av.SetCardCoverPosition(destItemID, source, position)
		}
	}
}

func (av *AttributeView) RemoveCardCoverPositions(itemID string) {
	delete(av.CardCoverPositions, itemID)
	if 0 == len(av.CardCoverPositions) {
		av.CardCoverPositions = nil
	}
}

func (av *AttributeView) RemoveCardCoverPositionsBySource(source string) {
	for itemID, sources := range av.CardCoverPositions {
		delete(sources, source)
		if 0 == len(sources) {
			delete(av.CardCoverPositions, itemID)
		}
	}
	if 0 == len(av.CardCoverPositions) {
		av.CardCoverPositions = nil
	}
}
