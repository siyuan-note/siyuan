// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var previewCollectionRemoval = contractHandler(apicontract.PreviewCollectionRemoval,
	func(c *gin.Context, request apicontract.CollectionRemovalPreviewRequest) apicontract.Response[*apicontract.CollectionRemovalPreview] {
		data, err := json.Marshal(request.Operations)
		if err != nil {
			return apicontract.Failure[*apicontract.CollectionRemovalPreview](-1, err.Error())
		}
		var operations []*model.Operation
		if err = json.Unmarshal(data, &operations); err != nil {
			return apicontract.Failure[*apicontract.CollectionRemovalPreview](-1, err.Error())
		}
		if err = holdTransactionEncryptedBoxRequests(c, []*model.Transaction{{DoOperations: operations}}); err != nil {
			return apicontract.Failure[*apicontract.CollectionRemovalPreview](-1, err.Error())
		}
		groups, err := model.PreviewCollectionRemoval(operations, request.TagChanges)
		if err != nil {
			return apicontract.Failure[*apicontract.CollectionRemovalPreview](-1, err.Error())
		}
		return apicontract.Success(groups)
	})
