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

package flashcard

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	// QueryVersion 是复习集查询 AST 的当前格式版本。
	QueryVersion  = 1
	maxQueryDepth = 32
	maxQueryNodes = 2048
)

// QueryOperator 描述查询表达式节点的布尔或谓词语义。
type QueryOperator string

const (
	QueryMatchAll  QueryOperator = "matchAll"
	QueryAnd       QueryOperator = "and"
	QueryOr        QueryOperator = "or"
	QueryNot       QueryOperator = "not"
	QueryPredicate QueryOperator = "predicate"
)

// QueryComparator 描述字段谓词的比较方式。
type QueryComparator string

const (
	QueryEqual        QueryComparator = "equal"
	QueryNotEqual     QueryComparator = "notEqual"
	QueryIn           QueryComparator = "in"
	QueryNotIn        QueryComparator = "notIn"
	QueryLess         QueryComparator = "less"
	QueryLessOrEqual  QueryComparator = "lessOrEqual"
	QueryGreater      QueryComparator = "greater"
	QueryGreaterEqual QueryComparator = "greaterOrEqual"
	QueryContains     QueryComparator = "contains"
	QueryStartsWith   QueryComparator = "startsWith"
	QueryExists       QueryComparator = "exists"
	QueryDescendantOf QueryComparator = "descendantOf"
)

// QueryAST 是可版本化、不可执行任意代码的复习集查询。
type QueryAST struct {
	Version int             `json:"version"`
	Root    QueryExpression `json:"root"`
}

// QueryExpression 表示一个布尔节点或字段谓词。
type QueryExpression struct {
	Operator   QueryOperator     `json:"operator"`
	Children   []QueryExpression `json:"children,omitempty"`
	Field      string            `json:"field,omitempty"`
	Comparator QueryComparator   `json:"comparator,omitempty"`
	Value      json.RawMessage   `json:"value,omitempty"`
}

var queryFieldComparators = map[string]map[QueryComparator]struct{}{
	"cardID":           comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"sourceID":         comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"templateID":       comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"schemaID":         comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"sourceType":       comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"generationStatus": comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"reviewState":      comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"due":              orderedComparators(),
	"lastReview":       orderedComparators(),
	"createdAt":        orderedComparators(),
	"updatedAt":        orderedComparators(),
	"reps":             orderedComparators(),
	"lapses":           orderedComparators(),
	"stability":        orderedComparators(),
	"difficulty":       orderedComparators(),
	"retrievability":   orderedComparators(),
	"suspended":        comparatorSet(QueryEqual, QueryNotEqual),
	"buried":           comparatorSet(QueryEqual, QueryNotEqual),
	"flag":             comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"tagID":            comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn, QueryDescendantOf),
	"priority":         comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn, QueryExists),
	"presetID":         comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn, QueryExists),
	"blockID":          comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"notebookID":       comparatorSet(QueryEqual, QueryNotEqual, QueryIn, QueryNotIn),
	"path":             comparatorSet(QueryEqual, QueryNotEqual, QueryContains, QueryStartsWith),
	"content":          comparatorSet(QueryContains),
}

func comparatorSet(comparators ...QueryComparator) map[QueryComparator]struct{} {
	ret := make(map[QueryComparator]struct{}, len(comparators))
	for _, comparator := range comparators {
		ret[comparator] = struct{}{}
	}
	return ret
}

func orderedComparators() map[QueryComparator]struct{} {
	return comparatorSet(QueryEqual, QueryNotEqual, QueryLess, QueryLessOrEqual, QueryGreater, QueryGreaterEqual)
}

// ParseQueryAST 严格解析并验证复习集查询。
func ParseQueryAST(data []byte) (QueryAST, error) {
	var query QueryAST
	if err := decodeStrictJSON(data, &query); err != nil {
		return QueryAST{}, fmt.Errorf("decode flashcard query: %w", err)
	}
	if err := query.Validate(); err != nil {
		return QueryAST{}, err
	}
	return query, nil
}

// Validate 校验查询版本、复杂度、字段和比较器组合。
func (query *QueryAST) Validate() error {
	if query == nil {
		return errors.New("flashcard query is nil")
	}
	if query.Version != QueryVersion {
		return fmt.Errorf("unsupported flashcard query version [%d]", query.Version)
	}
	nodes := 0
	if err := validateQueryExpression(&query.Root, 1, &nodes); err != nil {
		return err
	}
	return nil
}

func validateQueryExpression(expression *QueryExpression, depth int, nodes *int) error {
	if depth > maxQueryDepth {
		return errors.New("flashcard query exceeds the maximum depth")
	}
	(*nodes)++
	if *nodes > maxQueryNodes {
		return errors.New("flashcard query exceeds the maximum node count")
	}
	switch expression.Operator {
	case QueryMatchAll:
		if len(expression.Children) != 0 || expression.Field != "" || expression.Comparator != "" ||
			len(expression.Value) != 0 {
			return errors.New("match-all flashcard query must not contain operands")
		}
	case QueryAnd, QueryOr:
		if len(expression.Children) < 2 {
			return fmt.Errorf("flashcard query operator [%s] requires at least two children", expression.Operator)
		}
		if expression.Field != "" || expression.Comparator != "" || len(expression.Value) != 0 {
			return fmt.Errorf("flashcard query operator [%s] must not contain a predicate", expression.Operator)
		}
		for index := range expression.Children {
			if err := validateQueryExpression(&expression.Children[index], depth+1, nodes); err != nil {
				return err
			}
		}
	case QueryNot:
		if len(expression.Children) != 1 {
			return errors.New("flashcard query operator [not] requires exactly one child")
		}
		if expression.Field != "" || expression.Comparator != "" || len(expression.Value) != 0 {
			return errors.New("flashcard query operator [not] must not contain a predicate")
		}
		return validateQueryExpression(&expression.Children[0], depth+1, nodes)
	case QueryPredicate:
		return validateQueryPredicate(expression)
	default:
		return fmt.Errorf("unsupported flashcard query operator [%s]", expression.Operator)
	}
	return nil
}

func validateQueryPredicate(expression *QueryExpression) error {
	if len(expression.Children) != 0 {
		return errors.New("flashcard query predicate must not contain child expressions")
	}
	field := strings.TrimSpace(expression.Field)
	comparators, ok := queryFieldComparators[field]
	if !ok {
		return fmt.Errorf("unsupported flashcard query field [%s]", expression.Field)
	}
	if _, ok = comparators[expression.Comparator]; !ok {
		return fmt.Errorf("unsupported comparator [%s] for flashcard query field [%s]", expression.Comparator, field)
	}
	if expression.Comparator == QueryExists {
		if len(expression.Value) != 0 {
			return errors.New("flashcard query comparator [exists] must not contain a value")
		}
		return nil
	}
	if len(expression.Value) == 0 || !json.Valid(expression.Value) {
		return errors.New("flashcard query predicate value must be valid JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(expression.Value))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if value == nil {
		return errors.New("flashcard query predicate value must not be null")
	}
	if expression.Comparator == QueryIn || expression.Comparator == QueryNotIn {
		values, array := value.([]any)
		if !array || len(values) == 0 {
			return fmt.Errorf("flashcard query comparator [%s] requires a nonempty array", expression.Comparator)
		}
	}
	return nil
}
