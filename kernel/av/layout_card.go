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

// CardLayout 描述了卡片字段的布局方式。
type CardLayout int

const (
	CardLayoutList CardLayout = iota
	CardLayoutCompact
)

func (layout CardLayout) IsValid() bool {
	return CardLayoutList <= layout && layout <= CardLayoutCompact
}

// CardSettings 描述卡片类布局（卡片、看板）共有的封面与卡片设置。
// 各布局内嵌这份结构，持久化字段保持扁平，旧文件照常读写。
type CardSettings struct {
	CoverFrom            CoverFrom       `json:"coverFrom"`                     // 封面来源，0：无，1：内容图，2：资源字段
	CoverFromAssetKeyID  string          `json:"coverFromAssetKeyID,omitempty"` // 资源字段 ID，CoverFrom 为 2 时有效
	CardAspectRatio      CardAspectRatio `json:"cardAspectRatio"`               // 卡片宽高比
	CardAspectRatioValue float64         `json:"cardAspectRatioValue"`          // 卡片宽高比实际值，宽除以高
	CardSize             CardSize        `json:"cardSize"`                      // 卡片大小，0：小卡片，1：中卡片，2：大卡片
	CardWidth            int             `json:"cardWidth"`                     // 卡片宽度，单位为像素
	CardLayout           CardLayout      `json:"cardLayout"`                    // 卡片字段布局
	FitImage             bool            `json:"fitImage"`                      // 是否适应封面图片大小
	DisplayFieldName     bool            `json:"displayFieldName"`              // 是否显示字段名称
	DisplayEmptyFields   bool            `json:"displayEmptyFields"`            // 是否显示空字段
}

// NewCardSettings 返回卡片类布局共有的默认设置。
func NewCardSettings() CardSettings {
	return CardSettings{
		CoverFrom:            CoverFromContentImage,
		CardAspectRatio:      CardAspectRatio16_9,
		CardAspectRatioValue: CardAspectRatioValueByPreset(CardAspectRatio16_9),
		CardSize:             CardSizeMedium,
		CardWidth:            CardWidthBySize(CardSizeMedium),
		CardLayout:           CardLayoutList,
	}
}
