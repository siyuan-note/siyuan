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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func getBookmark(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	bookmarks := model.BuildBookmark()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		tempBookmarks := &model.Bookmarks{}
		for _, bookmark := range *bookmarks {
			bookmark.Blocks = model.FilterBlocksByPublishAccess(c, publishAccess, bookmark.Blocks)
			bookmark.Count = len(bookmark.Blocks)
			if bookmark.Count > 0 {
				*tempBookmarks = append(*tempBookmarks, bookmark)
			}
		}
		bookmarks = tempBookmarks
	}
	ret.Data = bookmarks
}

var removeBookmark = contractHandler(apicontract.RemoveBookmark, func(c *gin.Context, request apicontract.RemoveBookmarkRequest) apicontract.Response[apicontract.Null] {
	if err := model.RemoveBookmark(request.Bookmark); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})

var renameBookmark = contractHandler(apicontract.RenameBookmark, func(c *gin.Context, request apicontract.RenameBookmarkRequest) apicontract.Response[apicontract.Null] {
	if err := model.RenameBookmark(request.OldBookmark, request.NewBookmark); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})
