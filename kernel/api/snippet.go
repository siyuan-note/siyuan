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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getSnippet = contractHandler(apicontract.GetSnippet, func(c *gin.Context, request apicontract.GetSnippetRequest) apicontract.Response[apicontract.SnippetsData] {
	ret := gulu.Ret.NewResult()

	typ, enabledArg, keyword := request.Type, request.Enabled, request.Keyword

	enabled := true
	if 0 == int(enabledArg) {
		enabled = false
	}

	confSnippets, err := model.LoadSnippets()
	if err != nil {
		ret.Code = -1
		ret.Msg = "load snippets failed: " + err.Error()
		return contractFailure[apicontract.SnippetsData](ret)
	}

	isPublish := model.IsReadOnlyRoleContext(c)
	var snippets []*conf.Snippet
	for _, s := range confSnippets {
		if isPublish && s.DisabledInPublish {
			continue
		}
		if "all" != typ && s.Type != typ {
			continue
		}
		if 2 != enabledArg && s.Enabled != enabled {
			continue
		}

		snippets = append(snippets, s)
	}

	keyword = strings.TrimSpace(keyword)
	if "" != keyword {
		keyword = strings.ToLower(keyword)
		var snippetsFiltered []*conf.Snippet
		for _, s := range snippets {
			if strings.Contains(strings.ToLower(s.Name), keyword) || strings.Contains(strings.ToLower(s.Content), keyword) {
				snippetsFiltered = append(snippetsFiltered, s)
			}
		}
		snippets = snippetsFiltered
	}

	if 1 > len(snippets) {
		snippets = []*conf.Snippet{}
	}

	return apicontract.Success(apicontract.SnippetsData{Snippets: snippetContracts(snippets)})
})

var setSnippet = contractHandler(apicontract.SetSnippet, func(c *gin.Context, request apicontract.SetSnippetRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	var snippets []*conf.Snippet
	for _, s := range request.Snippets {
		snippet := &conf.Snippet{ID: s.ID, Name: s.Name, Type: s.Type, Content: s.Content, Enabled: s.Enabled, DisabledInPublish: s.DisabledInPublish}
		if "" == snippet.ID {
			snippet.ID = ast.NewNodeID()
		}
		if "css" == snippet.Type {
			if strings.Contains(strings.ToLower(snippet.Content), "</style") || strings.Contains(strings.ToLower(snippet.Content), "<script") {
				ret.Code = -1
				ret.Msg = "invalid css snippet content"
				return contractFailure[apicontract.Null](ret)
			}
		}
		snippets = append(snippets, snippet)
	}

	err := model.SetSnippet(snippets)
	if err != nil {
		ret.Code = -1
		ret.Msg = "set snippet failed: " + err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
})

var removeSnippet = contractHandler(apicontract.RemoveSnippet, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[*apicontract.Snippet] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	snippet, err := model.RemoveSnippet(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = "remove snippet failed: " + err.Error()
		return contractFailure[*apicontract.Snippet](ret)
	}
	return apicontract.Success(snippetContract(snippet))
})
