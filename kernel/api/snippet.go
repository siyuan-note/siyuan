// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getSnippet = contractHandler(apicontract.GetSnippet, func(c *gin.Context, request apicontract.GetSnippetRequest) apicontract.Response[apicontract.SnippetsData] {

	typ, enabledArg, keyword := request.Type, request.Enabled, request.Keyword

	enabled := true
	if 0 == int(enabledArg) {
		enabled = false
	}

	confSnippets, err := model.LoadSnippets()
	if err != nil {
		return apicontract.Failure[apicontract.SnippetsData](-1, "load snippets failed: "+err.Error())
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

	revision := ""
	if !isPublish {
		revision = model.SnippetsRevision(confSnippets)
	}
	return apicontract.Success(apicontract.SnippetsData{Snippets: snippetContracts(snippets), Revision: revision})
})

var setSnippet = contractHandler(apicontract.SetSnippet, func(c *gin.Context, request apicontract.SetSnippetRequest) apicontract.Response[apicontract.Null] {

	var snippets []*conf.Snippet
	for _, s := range request.Snippets {
		snippet := &conf.Snippet{ID: s.ID, Name: s.Name, Type: s.Type, Content: s.Content, Enabled: s.Enabled, DisabledInPublish: s.DisabledInPublish}
		if "" == snippet.ID {
			snippet.ID = ast.NewNodeID()
		}
		if "css" == snippet.Type {
			if strings.Contains(strings.ToLower(snippet.Content), "</style") || strings.Contains(strings.ToLower(snippet.Content), "<script") {
				return apicontract.Failure[apicontract.Null](-1, "invalid css snippet content")
			}
		}
		snippets = append(snippets, snippet)
	}

	var err error
	if request.Revision == nil {
		err = model.SetSnippet(snippets)
	} else {
		err = model.SetSnippet(snippets, *request.Revision)
	}
	if err != nil {
		msg := "set snippet failed: " + err.Error()
		if errors.Is(err, model.ErrSnippetConflict) {
			msg = model.ErrSnippetConflict.Error()
		}
		return apicontract.Failure[apicontract.Null](-1, msg)
	}

	return apicontract.Success(apicontract.Null{})
})

var removeSnippet = contractHandler(apicontract.RemoveSnippet, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[*apicontract.Snippet] {

	id := request.ID
	snippet, err := model.RemoveSnippet(id)
	if err != nil {
		return apicontract.Failure[*apicontract.Snippet](-1, "remove snippet failed: "+err.Error())
	}
	return apicontract.Success(snippetContract(snippet))
})
