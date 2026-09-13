package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type GlobalGraphRequest struct {
	K     string             `json:"k" api:"optional,nullable"`
	Conf  GraphConfiguration `json:"conf"`
	ReqID JSONValue          `json:"reqId" api:"optional,nullable"`
}

type LocalGraphRequest struct {
	Type     string             `json:"type" api:"optional,nullable,ignoretype"`
	K        string             `json:"k" api:"optional,nullable"`
	ID       *string            `json:"id" api:"optional"`
	Conf     GraphConfiguration `json:"conf" api:"optional"`
	Notebook string             `json:"notebook" api:"optional,nullable,ignoretype"`
	ReqID    JSONValue          `json:"reqId" api:"optional,nullable"`
}

type GraphNode struct {
	ID    string  `json:"id"`
	Box   string  `json:"box"`
	Path  string  `json:"path"`
	Size  float64 `json:"size"`
	Title string  `json:"title,omitempty"`
	Label string  `json:"label"`
	Type  string  `json:"type"`
	Refs  int     `json:"refs"`
	Defs  int     `json:"defs"`
}

type GraphLink struct {
	From   string       `json:"from"`
	To     string       `json:"to"`
	Ref    bool         `json:"ref"`
	Arrows *GraphArrows `json:"arrows"`
}
type GraphArrows struct {
	To *GraphArrowsTo `json:"to"`
}
type GraphArrowsTo struct {
	Enabled bool `json:"enabled"`
}

type GraphCorrelation struct {
	ReqID JSONValue `json:"reqId"`
}

type GraphElements struct {
	GraphCorrelation
	Box   string       `json:"box"`
	Nodes []*GraphNode `json:"nodes"`
	Links []*GraphLink `json:"links"`
}
type GlobalGraphResult struct {
	GraphElements
	Conf GlobalGraphConf `json:"conf"`
}
type LocalGraphResult struct {
	GraphElements
	ID   string         `json:"id"`
	Conf LocalGraphConf `json:"conf"`
}

// GraphQueryData 区分完整关系图和仅回传请求标识的结果。
type GraphQueryData[T any] struct {
	result      *T
	correlation GraphCorrelation
}
type GlobalGraphData = GraphQueryData[GlobalGraphResult]
type LocalGraphData = GraphQueryData[LocalGraphResult]

func GraphQueryResult[T any](result T) GraphQueryData[T] { return GraphQueryData[T]{result: &result} }
func GraphQueryEcho[T any](reqID JSONValue) GraphQueryData[T] {
	return GraphQueryData[T]{correlation: GraphCorrelation{ReqID: reqID}}
}
func (d GraphQueryData[T]) MarshalJSON() ([]byte, error) {
	if d.result != nil {
		return json.Marshal(d.result)
	}
	return json.Marshal(d.correlation)
}

type graphQueryDecodeError struct {
	reqID JSONValue
	cause error
}

func (e *graphQueryDecodeError) Error() string { return e.cause.Error() }

func graphQueryFields(reader io.Reader, path string) (map[string]json.RawMessage, JSONValue, error) {
	fields, err := blockRequestFields(reader, path)
	var reqID JSONValue
	if err != nil {
		return nil, reqID, err
	}
	if raw, exists := fields["reqId"]; exists {
		if err = json.Unmarshal(raw, &reqID); err != nil {
			return nil, reqID, err
		}
	}
	return fields, reqID, nil
}

func decodeGraphConfiguration(fields map[string]json.RawMessage) (value GraphConfiguration, err error) {
	if len(fields["conf"]) == 0 {
		return value, fmt.Errorf("Field [conf] is required")
	}
	err = json.Unmarshal(fields["conf"], &value)
	return
}

func init() {
	GetGraph.decodeRequest = func(reader io.Reader) (request GlobalGraphRequest, err error) {
		fields, reqID, err := graphQueryFields(reader, "/api/graph/getGraph")
		if err != nil {
			return request, err
		}
		request.ReqID = reqID
		defer func() {
			if err != nil {
				err = &graphQueryDecodeError{reqID, err}
			}
		}()
		if request.K, err = legacyField[string](fields, "k", "String", false); err != nil {
			return request, err
		}
		request.Conf, err = decodeGraphConfiguration(fields)
		return
	}
	GetLocalGraph.decodeRequest = func(reader io.Reader) (request LocalGraphRequest, err error) {
		fields, reqID, err := graphQueryFields(reader, "/api/graph/getLocalGraph")
		if err != nil {
			return request, err
		}
		request.ReqID = reqID
		defer func() {
			if err != nil {
				err = &graphQueryDecodeError{reqID, err}
			}
		}()
		if len(fields["id"]) == 0 || bytes.Equal(bytes.TrimSpace(fields["id"]), []byte("null")) {
			return request, nil
		}
		if request.K, err = legacyField[string](fields, "k", "String", false); err != nil {
			return request, err
		}
		id, err := legacyField[string](fields, "id", "String", true)
		if err != nil {
			return request, err
		}
		id = strings.TrimSpace(id)
		if id == "" {
			return request, fmt.Errorf("Field [id] must not be empty")
		}
		request.ID = &id
		configuration, err := decodeGraphConfiguration(fields)
		if err != nil {
			return request, err
		}
		request.Conf = configuration
		if raw, exists := fields["notebook"]; exists {
			_ = json.Unmarshal(raw, &request.Notebook)
		}
		return
	}
	GetGraph.decodeFailure = func(err error) Response[GlobalGraphData] {
		var failure *graphQueryDecodeError
		if errors.As(err, &failure) {
			return GetGraph.FailureWithData(-1, err.Error(), GraphQueryEcho[GlobalGraphResult](failure.reqID))
		}
		return Failure[GlobalGraphData](-1, err.Error())
	}
	GetLocalGraph.decodeFailure = func(err error) Response[LocalGraphData] {
		var failure *graphQueryDecodeError
		if errors.As(err, &failure) {
			return GetLocalGraph.FailureWithData(-1, err.Error(), GraphQueryEcho[LocalGraphResult](failure.reqID))
		}
		return Failure[LocalGraphData](-1, err.Error())
	}
}
