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

package conf

type Flashcard struct {
	NewCardLimit    int  `json:"newCardLimit"`    // 新卡上限 https://github.com/siyuan-note/siyuan/issues/7695
	ReviewCardLimit int  `json:"reviewCardLimit"` // 复习卡上限 https://github.com/siyuan-note/siyuan/issues/7703
	Mark            bool `json:"mark"`            // 是否启用标记制卡 https://github.com/siyuan-note/siyuan/issues/7794
	List            bool `json:"list"`            // 是否启用列表块制卡 https://github.com/siyuan-note/siyuan/issues/7701
	SuperBlock      bool `json:"superBlock"`      // 是否启用超级块制卡 https://github.com/siyuan-note/siyuan/issues/7702
	Deck            bool `json:"deck"`            // 是否启用卡包制卡 https://github.com/siyuan-note/siyuan/issues/7724
}

func NewFlashcard() *Flashcard {
	return &Flashcard{
		NewCardLimit:    20,
		ReviewCardLimit: 200,
		Mark:            true,
		List:            true,
		SuperBlock:      true,
		Deck:            false,
	}
}
