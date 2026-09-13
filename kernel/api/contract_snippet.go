package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func snippetContract(value *conf.Snippet) *apicontract.Snippet {
	if value == nil {
		return nil
	}
	return &apicontract.Snippet{ID: value.ID, Name: value.Name, Type: value.Type, Content: value.Content, Enabled: value.Enabled, DisabledInPublish: value.DisabledInPublish}
}

func snippetContracts(values []*conf.Snippet) []*apicontract.Snippet {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.Snippet, len(values))
	for i, value := range values {
		result[i] = snippetContract(value)
	}
	return result
}
