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
	"encoding/json"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

var flushTransaction = contractHandler(apicontract.FlushTransaction, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	// Add internal kernel API `/api/sqlite/flushTransaction` https://github.com/siyuan-note/siyuan/issues/10005

	model.FlushTxQueue()
	sql.FlushQueue()

	return apicontract.Success(apicontract.Null{})
})

var SQL = contractHandler(apicontract.QuerySQL, func(c *gin.Context, request apicontract.SQLQueryRequest) apicontract.Response[apicontract.SQLRows] {
	stmt, mode := request.Stmt, request.Mode
	switch mode {
	case "":
		// 默认模式，允许单条语句
		if err := sql.CheckSingleStatement(stmt); err != nil {
			return apicontract.Failure[apicontract.SQLRows](-1, err.Error())
		}
	case "readonly":
		// 只读模式，允许单条语句
		if err := sql.CheckSingleStatement(stmt); err != nil {
			return apicontract.Failure[apicontract.SQLRows](-1, err.Error())
		}
		if err := sql.CheckReadonlyStatement(stmt); err != nil {
			return apicontract.Failure[apicontract.SQLRows](-1, err.Error())
		}
	case "multiple":
		// 多语句模式，不做校验
	default:
		// 未知模式
		return apicontract.Failure[apicontract.SQLRows](-1, "unknown [mode]")
	}

	result, info, err := sql.QueryWithLimitInfo(stmt, model.Conf.Search.Limit)
	if err != nil {
		return apicontract.Failure[apicontract.SQLRows](1, err.Error())
	}

	data, err := json.Marshal(result)
	if err != nil {
		return apicontract.Failure[apicontract.SQLRows](1, err.Error())
	}
	var rows apicontract.SQLRows
	if err = json.Unmarshal(data, &rows); err != nil {
		return apicontract.Failure[apicontract.SQLRows](1, err.Error())
	}
	return apicontract.SuccessSQL(rows, info.Limit, info.Truncated)
})
