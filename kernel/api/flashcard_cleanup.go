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
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func inspectInvalidFlashcardSources(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	report, err := model.InspectInvalidFlashcardV2Sources(c.Request.Context())
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = report
}

func deleteInvalidFlashcardSources(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	request := &flashcardv2.DeleteInvalidSourcesRequest{}
	if !bindFlashcardRequest(c, ret, request) {
		return
	}
	result, err := model.DeleteInvalidFlashcardV2Sources(c.Request.Context(), *request)
	if err != nil {
		setFlashcardAPIError(ret, err)
		return
	}
	ret.Data = result
}
