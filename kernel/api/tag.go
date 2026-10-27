// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func tagContracts(tags model.Tags) []*apicontract.TagData {
	if tags == nil {
		return nil
	}
	ret := make([]*apicontract.TagData, len(tags))
	for i, tag := range tags {
		if tag != nil {
			// 模型层的 Name/Label 为 HTML 转义形态，前端负责按上下文转义，这里还原为纯文本
			ret[i] = &apicontract.TagData{Name: util.UnescapeHTML(tag.Name), Label: tag.Label, Children: tagContracts(tag.Children),
				Type: tag.Type, Depth: tag.Depth, Count: tag.Count}
		}
	}
	return ret
}

var getTag = contractHandler(apicontract.GetTag, func(c *gin.Context, request apicontract.GetTagRequest) apicontract.Response[[]*apicontract.TagData] {
	if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
		model.UpdateTagConf(func(s *conf.Tag) { s.Sort = int(request.Sort) })
	}
	tags := model.BuildTags(request.IgnoreMaxListHint, request.App, int(request.Sort))
	if model.IsReadOnlyRoleContext(c) {
		tags = model.FilterTagsByPublishAccess(c, model.GetPublishAccess(), tags)
	}
	if tags == nil {
		return apicontract.Success[[]*apicontract.TagData](nil)
	}
	return apicontract.Success(tagContracts(*tags))
})

var renameTag = contractHandler(apicontract.RenameTag, func(c *gin.Context, request apicontract.RenameTagRequest) apicontract.Response[apicontract.Null] {
	if err := model.RenameTag(request.OldLabel, request.NewLabel); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})

var removeTag = contractHandler(apicontract.RemoveTag, func(c *gin.Context, request apicontract.RemoveTagRequest) apicontract.Response[apicontract.Null] {
	if err := model.RemoveTag(request.Label); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})
