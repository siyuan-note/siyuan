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
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func tagContracts(tags model.Tags) []*apicontract.TagData {
	if tags == nil {
		return nil
	}
	ret := make([]*apicontract.TagData, len(tags))
	for i, tag := range tags {
		if tag != nil {
			ret[i] = &apicontract.TagData{Name: tag.Name, Label: tag.Label, Children: tagContracts(tag.Children),
				Type: tag.Type, Depth: tag.Depth, Count: tag.Count}
		}
	}
	return ret
}

var getTag = contractHandler(apicontract.GetTag, func(c *gin.Context, request apicontract.GetTagRequest) apicontract.Response[[]*apicontract.TagData] {
	if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
		model.Conf.Tag.Sort = int(request.Sort)
		model.Conf.Save()
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
