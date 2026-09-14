package apicontract

import (
	"encoding/json"
	"io"
	"reflect"
)

type SearchHeadingFilter struct {
	H1 bool `json:"h1" api:"optional,nullable"`
	H2 bool `json:"h2" api:"optional,nullable"`
	H3 bool `json:"h3" api:"optional,nullable"`
	H4 bool `json:"h4" api:"optional,nullable"`
	H5 bool `json:"h5" api:"optional,nullable"`
	H6 bool `json:"h6" api:"optional,nullable"`
}

type SearchListFilter struct {
	Ordered   bool `json:"o" api:"optional,nullable"`
	Unordered bool `json:"u" api:"optional,nullable"`
	Task      bool `json:"t" api:"optional,nullable"`
}

type SearchSubtypeFilter struct {
	Heading  SearchHeadingFilter `json:"heading" api:"optional,nullable"`
	List     SearchListFilter    `json:"list" api:"optional,nullable"`
	ListItem SearchListFilter    `json:"listItem" api:"optional,nullable"`
}

func (s *SearchSubtypeFilter) Selected() map[string]bool {
	if s == nil {
		return nil
	}
	result := map[string]bool{}
	for key, selected := range map[string]bool{
		"h1": s.Heading.H1, "h2": s.Heading.H2, "h3": s.Heading.H3,
		"h4": s.Heading.H4, "h5": s.Heading.H5, "h6": s.Heading.H6,
		"list:o": s.List.Ordered, "list:u": s.List.Unordered, "list:t": s.List.Task,
		"listItem:o": s.ListItem.Ordered, "listItem:u": s.ListItem.Unordered, "listItem:t": s.ListItem.Task,
	} {
		if selected {
			result[key] = true
		}
	}
	return result
}

type SearchBlockRequest struct {
	SearchAssetContentRequest
	Paths    []string             `json:"paths" api:"optional,nullable"`
	SubTypes *SearchSubtypeFilter `json:"subTypes" api:"optional"`
	GroupBy  float64              `json:"groupBy" api:"optional,nullable"`
}

type FullTextSearchBlockRequest struct {
	SearchBlockRequest
	Notebook    string `json:"notebook" api:"optional,nullable,ignoretype"`
	SearchHPath *bool  `json:"searchHPath" api:"optional"`
}

type FullTextSearchBlockData struct {
	SearchBlocksData
	DocMode bool `json:"docMode"`
}

type FindReplaceRequest struct {
	SearchBlockRequest
	K            string          `json:"k"`
	R            string          `json:"r"`
	IDs          []string        `json:"ids"`
	ReplaceTypes map[string]bool `json:"replaceTypes" api:"optional,nullable"`
}

// 搜索子类型忽略非对象输入；路径和普通筛选参数仍按声明校验。
func searchQueryFields(reader io.Reader, path string) (map[string]json.RawMessage, error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return nil, err
	}
	var groups map[string]json.RawMessage
	if json.Unmarshal(fields["subTypes"], &groups) != nil {
		delete(fields, "subTypes")
	} else if groups != nil {
		for _, name := range []string{"heading", "list", "listItem"} {
			var entries map[string]json.RawMessage
			if json.Unmarshal(groups[name], &entries) != nil {
				delete(groups, name)
				continue
			}
			for key, raw := range entries {
				var selected *bool
				if json.Unmarshal(raw, &selected) != nil {
					delete(entries, key)
				}
			}
			groups[name], err = json.Marshal(entries)
			if err != nil {
				return nil, err
			}
		}
		fields["subTypes"], err = json.Marshal(groups)
	}
	return fields, err
}

func init() {
	SemanticSearchBlock.decodeRequest = func(reader io.Reader) (request SearchBlockRequest, err error) {
		fields, err := searchQueryFields(reader, "/api/search/semanticSearchBlock")
		if err == nil {
			err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields)
		}
		return
	}
	FindReplace.decodeRequest = func(reader io.Reader) (request FindReplaceRequest, err error) {
		fields, err := searchQueryFields(reader, "/api/search/findReplace")
		if err == nil {
			err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields)
		}
		return
	}
	FullTextSearchBlock.decodeRequest = func(reader io.Reader) (request FullTextSearchBlockRequest, err error) {
		fields, err := searchQueryFields(reader, "/api/search/fullTextSearchBlock")
		if err != nil {
			return request, err
		}
		var hpath *bool
		if json.Unmarshal(fields["searchHPath"], &hpath) != nil {
			delete(fields, "searchHPath")
		}
		err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields)
		return
	}
}
