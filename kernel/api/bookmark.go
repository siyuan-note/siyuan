// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getBookmark = contractHandler(apicontract.GetBookmark, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.Bookmark] {

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
	return apicontract.Success(bookmarkContracts(bookmarks))
})

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
