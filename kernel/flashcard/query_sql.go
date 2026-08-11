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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const maxCardSearchLimit = 1000000

// CardSearchOptions 控制管理查询是否包含不可复习状态。
type CardSearchOptions struct {
	Now              int64 `json:"now"`
	IncludeInactive  bool  `json:"includeInactive"`
	IncludeSuspended bool  `json:"includeSuspended"`
	IncludeBuried    bool  `json:"includeBuried"`
	IncludePaused    bool  `json:"includePaused"`
	IncludeConflicts bool  `json:"includeConflicts"`
	Limit            int   `json:"limit"`
	Offset           int   `json:"offset"`
}

// CardSearchResult 返回卡片、共享复习状态和当前卡源配置。
type CardSearchResult struct {
	Card              Card        `json:"card"`
	ReviewState       ReviewState `json:"reviewState"`
	SourceType        string      `json:"sourceType"`
	SourcePriority    string      `json:"sourcePriority"`
	InheritedPriority string      `json:"inheritedPriority"`
	DefaultPresetID   string      `json:"defaultPresetID"`
	CardTagIDs        []string    `json:"cardTagIDs"`
	SourceTagIDs      []string    `json:"sourceTagIDs"`
	EffectiveTagIDs   []string    `json:"effectiveTagIDs"`
	EffectivePriority string      `json:"effectivePriority"`
	EffectivePresetID string      `json:"effectivePresetID"`
	SourceNotebookID  string      `json:"sourceNotebookID,omitempty"`
	SourceRootID      string      `json:"sourceRootID,omitempty"`
	SourcePath        string      `json:"sourcePath,omitempty"`
	SourceAvailable   bool        `json:"sourceAvailable"`
}

// ReviewSetCardPage 返回复习集合并成员后的稳定分页和未分页总数。
type ReviewSetCardPage struct {
	CardIDs []string `json:"cardIDs"`
	Total   int      `json:"total"`
}

type compiledQuery struct {
	sql  string
	args []any
}

const (
	primaryBlockNotebookSQL = `(SELECT metadata.notebook_id FROM card_source_refs primary_ref
		JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
		WHERE primary_ref.id = s.primary_ref_id AND primary_ref.entity_type = 'block' LIMIT 1)`
	primaryBlockPathSQL = `(SELECT metadata.path FROM card_source_refs primary_ref
		JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
		WHERE primary_ref.id = s.primary_ref_id AND primary_ref.entity_type = 'block' LIMIT 1)`
	documentPolicyPrioritySQL = `(SELECT policy.priority FROM card_source_refs primary_ref
		JOIN block_metadata source_metadata ON source_metadata.block_id = primary_ref.entity_id
		JOIN study_policies policy ON policy.scope_type = 'document'
		WHERE primary_ref.id = s.primary_ref_id AND primary_ref.entity_type = 'block'
		AND (source_metadata.root_id = policy.scope_id OR
			source_metadata.path LIKE '%/' || policy.scope_id || '/%')
		ORDER BY CASE WHEN source_metadata.root_id = policy.scope_id THEN 2147483647
			ELSE instr(source_metadata.path, '/' || policy.scope_id || '/') END DESC LIMIT 1)`
	notebookPolicyPrioritySQL = `(SELECT policy.priority FROM card_source_refs primary_ref
		JOIN block_metadata source_metadata ON source_metadata.block_id = primary_ref.entity_id
		JOIN study_policies policy ON policy.scope_type = 'notebook' AND policy.scope_id = source_metadata.notebook_id
		WHERE primary_ref.id = s.primary_ref_id AND primary_ref.entity_type = 'block' LIMIT 1)`
	inheritedPrioritySQL = `COALESCE(NULLIF(s.priority, ''), NULLIF(` + documentPolicyPrioritySQL + `, ''),
		NULLIF(` + notebookPolicyPrioritySQL + `, ''), 'unset')`
	effectivePrioritySQL = `COALESCE(NULLIF(c.priority_override, ''), ` + inheritedPrioritySQL + `)`
	sourceAvailableSQL   = `COALESCE((SELECT availability.available FROM source_availability availability
		WHERE availability.source_id = c.source_id), 1)`
	effectiveGenerationStatusSQL = `CASE WHEN c.generation_status = 'active' AND ` + sourceAvailableSQL +
		` = 0 THEN 'orphaned' ELSE c.generation_status END`
)

var querySQLFields = map[string]string{
	"cardID":           "c.id",
	"sourceID":         "c.source_id",
	"templateID":       "c.template_id",
	"schemaID":         "s.schema_id",
	"sourceType":       "s.source_type",
	"generationStatus": effectiveGenerationStatusSQL,
	"reviewState":      "rs.state",
	"due":              "rs.due",
	"lastReview":       "COALESCE(rs.last_review, 0)",
	"createdAt":        "c.created_at",
	"updatedAt":        "c.updated_at",
	"reps":             "rs.reps",
	"lapses":           "rs.lapses",
	"suspended":        "rs.suspended",
	"flag":             "c.flag",
	"priority":         effectivePrioritySQL,
	"presetID":         "COALESCE(NULLIF(c.preset_override_id, ''), s.default_preset_id)",
	"notebookID":       primaryBlockNotebookSQL,
	"path":             primaryBlockPathSQL,
}

var numericQueryFields = map[string]struct{}{
	"due": {}, "lastReview": {}, "createdAt": {}, "updatedAt": {}, "reps": {}, "lapses": {}, "flag": {},
}

// SearchCards 使用受限 AST 查询业务投影，不接受调用方提供 SQL。
func (projection *Projection) SearchCards(ctx context.Context, query *QueryAST,
	options CardSearchOptions) ([]CardSearchResult, error) {
	if options.Now < 0 || options.Offset < 0 || options.Limit < 0 || options.Limit > maxCardSearchLimit {
		return nil, errors.New("flashcard search options are invalid")
	}
	limit := options.Limit
	if limit == 0 {
		limit = maxCardSearchLimit
	}
	compiled := compiledQuery{sql: "1 = 1"}
	if query != nil {
		if err := query.Validate(); err != nil {
			return nil, err
		}
		var err error
		compiled, err = compileQueryExpression(&query.Root, options.Now)
		if err != nil {
			return nil, err
		}
	}
	where := []string{"(" + compiled.sql + ")"}
	args := append([]any(nil), compiled.args...)
	if !options.IncludeInactive {
		where = append(where, effectiveGenerationStatusSQL+" = ?")
		args = append(args, GenerationActive)
	}
	if !options.IncludeSuspended {
		where = append(where, "rs.suspended = 0")
	}
	if !options.IncludeBuried {
		where = append(where, "COALESCE(rs.buried_until, 0) <= ?")
		args = append(args, options.Now)
	}
	if !options.IncludePaused {
		where = append(where, effectivePrioritySQL+" <> 'paused'")
	}
	if !options.IncludeConflicts {
		where = append(where, `NOT EXISTS (SELECT 1 FROM entity_conflicts ec
			WHERE ec.resolved = 0 AND (
				(ec.entity_type IN (?, ?) AND ec.entity_id = c.id) OR
				(ec.entity_type = ? AND ec.entity_id = c.source_id) OR
				(ec.entity_type = ? AND ec.entity_id = c.template_id) OR
				(ec.entity_type = ? AND ec.entity_id = s.schema_id) OR
				(ec.entity_type = ? AND ec.entity_id IN (
					SELECT ref.id FROM card_source_refs ref WHERE ref.source_id = c.source_id
				)) OR
				(ec.entity_type = ? AND ec.entity_id =
					COALESCE(NULLIF(c.preset_override_id, ''), s.default_preset_id)) OR
				(ec.entity_type = ? AND ec.entity_id IN (
					SELECT policy.id FROM study_policies policy
					JOIN card_source_refs primary_ref ON primary_ref.id = s.primary_ref_id
					LEFT JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
					WHERE (policy.scope_type = 'document' AND (policy.scope_id = metadata.root_id OR
						metadata.path LIKE '%/' || policy.scope_id || '/%')) OR
						(policy.scope_type = 'notebook' AND policy.scope_id = metadata.notebook_id)
				)) OR
				(ec.entity_type = ? AND ec.entity_id IN (
					SELECT assignment.id FROM tag_assignments assignment
					WHERE (assignment.target_type = 'card' AND assignment.target_id = c.id) OR
						(assignment.target_type = 'source' AND assignment.target_id = c.source_id)
				))
			))`)
		args = append(args, EntityCard, EntityReviewState, EntityCardSource, EntityCardTemplate, EntityCardSchema,
			EntityCardSourceRef, EntitySchedulerPreset, EntityStudyPolicy, EntityTagAssignment)
	}
	args = append(args, limit, options.Offset)
	statement := `SELECT ce.payload, se.payload, s.source_type, s.priority, ` + inheritedPrioritySQL +
		`, s.default_preset_id, ` + effectivePrioritySQL + `, COALESCE(` + primaryBlockNotebookSQL +
		`, ''), COALESCE(` + primaryBlockPathSQL + `, ''), COALESCE(
		(SELECT metadata.root_id FROM card_source_refs primary_ref
			JOIN block_metadata metadata ON metadata.block_id = primary_ref.entity_id
			WHERE primary_ref.id = s.primary_ref_id AND primary_ref.entity_type = 'block' LIMIT 1), ''), ` +
		sourceAvailableSQL + `,
		COALESCE((SELECT json_group_array(tag_id) FROM (
			SELECT ta.tag_id FROM tag_assignments ta WHERE ta.target_type = 'card' AND ta.target_id = c.id
			ORDER BY ta.tag_id
		)), '[]'),
		COALESCE((SELECT json_group_array(tag_id) FROM (
			SELECT ta.tag_id FROM tag_assignments ta WHERE ta.target_type = 'source' AND ta.target_id = c.source_id
			ORDER BY ta.tag_id
		)), '[]')
		FROM cards c
		JOIN entities ce ON ce.entity_type = ? AND ce.entity_id = c.id AND ce.deleted = 0
		JOIN review_states rs ON rs.card_id = c.id
		JOIN entities se ON se.entity_type = ? AND se.entity_id = rs.card_id AND se.deleted = 0
		JOIN card_sources s ON s.id = c.source_id
		WHERE ` + strings.Join(where, " AND ") + ` ORDER BY c.id LIMIT ? OFFSET ?`
	args = append([]any{EntityCard, EntityReviewState}, args...)
	rows, err := projection.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, fmt.Errorf("search flashcards: %w", err)
	}
	defer rows.Close()
	var ret []CardSearchResult
	for rows.Next() {
		var cardPayload, statePayload []byte
		var cardTagIDs, sourceTagIDs []byte
		var result CardSearchResult
		if err = rows.Scan(&cardPayload, &statePayload, &result.SourceType, &result.SourcePriority,
			&result.InheritedPriority, &result.DefaultPresetID, &result.EffectivePriority,
			&result.SourceNotebookID, &result.SourcePath, &result.SourceRootID, &result.SourceAvailable,
			&cardTagIDs, &sourceTagIDs); err != nil {
			return nil, fmt.Errorf("scan flashcard search result: %w", err)
		}
		if err = decodeStrictJSON(cardPayload, &result.Card); err != nil {
			return nil, err
		}
		if err = decodeStrictJSON(statePayload, &result.ReviewState); err != nil {
			return nil, err
		}
		if !result.SourceAvailable && result.Card.GenerationStatus == GenerationActive {
			result.Card.GenerationStatus = GenerationOrphaned
		}
		if err = decodeStrictJSON(cardTagIDs, &result.CardTagIDs); err != nil {
			return nil, err
		}
		if err = decodeStrictJSON(sourceTagIDs, &result.SourceTagIDs); err != nil {
			return nil, err
		}
		result.EffectiveTagIDs = mergeSortedStringSets(result.CardTagIDs, result.SourceTagIDs)
		result.EffectivePresetID = result.Card.PresetOverrideID
		if result.EffectivePresetID == "" {
			result.EffectivePresetID = result.DefaultPresetID
		}
		ret = append(ret, result)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard search results: %w", err)
	}
	return ret, nil
}

func mergeSortedStringSets(sets ...[]string) []string {
	values := map[string]struct{}{}
	for _, set := range sets {
		for _, value := range set {
			values[value] = struct{}{}
		}
	}
	ret := make([]string, 0, len(values))
	for value := range values {
		ret = append(ret, value)
	}
	sort.Strings(ret)
	return ret
}

// ReviewSetCardIDs 计算动态命中与手动成员，并始终让排除项优先。
func (projection *Projection) ReviewSetCardIDs(ctx context.Context, reviewSetID string,
	options CardSearchOptions) ([]string, error) {
	page, err := projection.ReviewSetCardPage(ctx, reviewSetID, options)
	return page.CardIDs, err
}

// ReviewSetCardPage 计算动态命中和手动关系后再分页，保证偏移不会改变集合语义。
func (projection *Projection) ReviewSetCardPage(ctx context.Context, reviewSetID string,
	options CardSearchOptions) (ReviewSetCardPage, error) {
	if options.Offset < 0 || options.Limit < 0 || options.Limit > maxCardSearchLimit {
		return ReviewSetCardPage{}, errors.New("flashcard review set page options are invalid")
	}
	revision, found, err := projection.CurrentEntity(ctx, EntityReviewSet, reviewSetID)
	if err != nil {
		return ReviewSetCardPage{}, err
	}
	if !found || revision.Deleted {
		return ReviewSetCardPage{}, errors.New("flashcard review set was not found")
	}
	if !options.IncludeConflicts {
		conflicted, conflictErr := projection.entityHasUnresolvedConflict(ctx, EntityReviewSet, reviewSetID)
		if conflictErr != nil {
			return ReviewSetCardPage{}, conflictErr
		}
		if conflicted {
			return ReviewSetCardPage{}, errors.New("flashcard review set has an unresolved conflict")
		}
	}
	var reviewSet ReviewSet
	if err = decodeStrictJSON(revision.Payload, &reviewSet); err != nil {
		return ReviewSetCardPage{}, err
	}
	setOptions := options
	setOptions.Limit = 0
	setOptions.Offset = 0
	eligibleResults, err := projection.SearchCards(ctx, nil, setOptions)
	if err != nil {
		return ReviewSetCardPage{}, err
	}
	eligible := make(map[string]struct{}, len(eligibleResults))
	for _, result := range eligibleResults {
		eligible[result.Card.ID] = struct{}{}
	}
	selected := map[string]struct{}{}
	if len(reviewSet.QueryAST) != 0 {
		query, parseErr := ParseQueryAST(reviewSet.QueryAST)
		if parseErr != nil {
			return ReviewSetCardPage{}, parseErr
		}
		dynamicResults, searchErr := projection.SearchCards(ctx, &query, setOptions)
		if searchErr != nil {
			return ReviewSetCardPage{}, searchErr
		}
		for _, result := range dynamicResults {
			selected[result.Card.ID] = struct{}{}
		}
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT membership.card_id, membership.mode,
		EXISTS(SELECT 1 FROM entity_conflicts conflict WHERE conflict.entity_type = ?
			AND conflict.entity_id = membership.id AND conflict.resolved = 0)
		FROM review_set_memberships membership WHERE membership.review_set_id = ?
		ORDER BY membership.card_id`, EntityReviewSetMembership, reviewSetID)
	if err != nil {
		return ReviewSetCardPage{}, fmt.Errorf("query review set memberships: %w", err)
	}
	excluded := map[string]struct{}{}
	conflictedMemberships := map[string]struct{}{}
	for rows.Next() {
		var cardID string
		var mode MembershipMode
		var conflicted bool
		if err = rows.Scan(&cardID, &mode, &conflicted); err != nil {
			_ = rows.Close()
			return ReviewSetCardPage{}, fmt.Errorf("scan review set membership: %w", err)
		}
		if conflicted && !options.IncludeConflicts {
			conflictedMemberships[cardID] = struct{}{}
			delete(selected, cardID)
			continue
		}
		if mode == MembershipExclude {
			excluded[cardID] = struct{}{}
			delete(selected, cardID)
		} else if _, available := eligible[cardID]; available {
			selected[cardID] = struct{}{}
		}
	}
	if err = rows.Close(); err != nil {
		return ReviewSetCardPage{}, err
	}
	for cardID := range excluded {
		delete(selected, cardID)
	}
	for cardID := range conflictedMemberships {
		delete(selected, cardID)
	}
	ret := make([]string, 0, len(selected))
	for cardID := range selected {
		if _, available := eligible[cardID]; available {
			ret = append(ret, cardID)
		}
	}
	sort.Strings(ret)
	total := len(ret)
	start := min(options.Offset, total)
	end := total
	if options.Limit > 0 {
		end = min(start+options.Limit, total)
	}
	return ReviewSetCardPage{CardIDs: append([]string(nil), ret[start:end]...), Total: total}, nil
}

func compileQueryExpression(expression *QueryExpression, now int64) (compiledQuery, error) {
	switch expression.Operator {
	case QueryMatchAll:
		return compiledQuery{sql: "1 = 1"}, nil
	case QueryAnd, QueryOr:
		operator := " AND "
		if expression.Operator == QueryOr {
			operator = " OR "
		}
		parts := make([]string, 0, len(expression.Children))
		var args []any
		for index := range expression.Children {
			child, err := compileQueryExpression(&expression.Children[index], now)
			if err != nil {
				return compiledQuery{}, err
			}
			parts = append(parts, "("+child.sql+")")
			args = append(args, child.args...)
		}
		return compiledQuery{sql: strings.Join(parts, operator), args: args}, nil
	case QueryNot:
		child, err := compileQueryExpression(&expression.Children[0], now)
		if err != nil {
			return compiledQuery{}, err
		}
		return compiledQuery{sql: "NOT (" + child.sql + ")", args: child.args}, nil
	case QueryPredicate:
		return compileQueryPredicate(expression, now)
	default:
		return compiledQuery{}, fmt.Errorf("unsupported flashcard query operator [%s]", expression.Operator)
	}
}

func compileQueryPredicate(expression *QueryExpression, now int64) (compiledQuery, error) {
	if expression.Field == "tagID" {
		return compileTagPredicate(expression)
	}
	if expression.Field == "blockID" {
		return compileBlockPredicate(expression)
	}
	if expression.Field == "buried" {
		value, err := decodeQueryBool(expression.Value)
		if err != nil {
			return compiledQuery{}, err
		}
		if expression.Comparator == QueryNotEqual {
			value = !value
		}
		operator := ">"
		if !value {
			operator = "<="
		}
		return compiledQuery{sql: "COALESCE(rs.buried_until, 0) " + operator + " ?", args: []any{now}}, nil
	}
	column, found := querySQLFields[expression.Field]
	if !found {
		return compiledQuery{}, fmt.Errorf("unsupported projected flashcard query field [%s]", expression.Field)
	}
	if expression.Comparator == QueryExists {
		empty := "''"
		if expression.Field == "priority" {
			empty = "'unset'"
		}
		return compiledQuery{sql: column + " <> " + empty}, nil
	}
	values, err := decodeQueryValues(expression.Value, expression.Comparator == QueryIn ||
		expression.Comparator == QueryNotIn)
	if err != nil {
		return compiledQuery{}, err
	}
	for index, value := range values {
		if _, numeric := numericQueryFields[expression.Field]; numeric {
			number, numberErr := queryNumber(value)
			if numberErr != nil {
				return compiledQuery{}, fmt.Errorf("flashcard query field [%s] requires a number", expression.Field)
			}
			values[index] = number
		} else if expression.Field == "suspended" {
			boolean, booleanErr := queryBool(value)
			if booleanErr != nil {
				return compiledQuery{}, errors.New("flashcard suspended query requires a boolean")
			}
			values[index] = boolean
		} else {
			text, textOK := value.(string)
			if !textOK {
				return compiledQuery{}, fmt.Errorf("flashcard query field [%s] requires text", expression.Field)
			}
			values[index] = text
		}
	}
	return compileColumnComparison(column, expression.Comparator, values)
}

func compileTagPredicate(expression *QueryExpression) (compiledQuery, error) {
	values, err := decodeQueryValues(expression.Value, expression.Comparator == QueryIn ||
		expression.Comparator == QueryNotIn)
	if err != nil {
		return compiledQuery{}, err
	}
	for _, value := range values {
		if _, ok := value.(string); !ok {
			return compiledQuery{}, errors.New("flashcard tag query requires text IDs")
		}
	}
	targetMatch := `((ta.target_type = 'card' AND ta.target_id = c.id) OR
		(ta.target_type = 'source' AND ta.target_id = c.source_id))`
	if expression.Comparator == QueryDescendantOf {
		return compiledQuery{
			sql: `EXISTS (WITH RECURSIVE tag_tree(id) AS (
				SELECT ? UNION SELECT t.id FROM tags t JOIN tag_tree p ON t.parent_id = p.id
			) SELECT 1 FROM tag_assignments ta JOIN tag_tree tt ON tt.id = ta.tag_id WHERE ` + targetMatch + `)`,
			args: values,
		}, nil
	}
	comparator := expression.Comparator
	negated := comparator == QueryNotEqual || comparator == QueryNotIn
	if comparator == QueryNotEqual {
		comparator = QueryEqual
	} else if comparator == QueryNotIn {
		comparator = QueryIn
	}
	comparison, err := compileColumnComparison("ta.tag_id", comparator, values)
	if err != nil {
		return compiledQuery{}, err
	}
	exists := "EXISTS"
	if negated {
		exists = "NOT EXISTS"
	}
	return compiledQuery{
		sql:  exists + " (SELECT 1 FROM tag_assignments ta WHERE " + targetMatch + " AND " + comparison.sql + ")",
		args: comparison.args,
	}, nil
}

func compileBlockPredicate(expression *QueryExpression) (compiledQuery, error) {
	values, err := decodeQueryValues(expression.Value, expression.Comparator == QueryIn ||
		expression.Comparator == QueryNotIn)
	if err != nil {
		return compiledQuery{}, err
	}
	for _, value := range values {
		if _, ok := value.(string); !ok {
			return compiledQuery{}, errors.New("flashcard block query requires text IDs")
		}
	}
	comparator := expression.Comparator
	negated := comparator == QueryNotEqual || comparator == QueryNotIn
	if comparator == QueryNotEqual {
		comparator = QueryEqual
	} else if comparator == QueryNotIn {
		comparator = QueryIn
	}
	comparison, err := compileColumnComparison("ref.entity_id", comparator, values)
	if err != nil {
		return compiledQuery{}, err
	}
	exists := "EXISTS"
	if negated {
		exists = "NOT EXISTS"
	}
	return compiledQuery{
		sql: exists + ` (SELECT 1 FROM card_source_refs ref WHERE ref.source_id = c.source_id
			AND ref.entity_type = 'block' AND ` + comparison.sql + `)`,
		args: comparison.args,
	}, nil
}

func compileColumnComparison(column string, comparator QueryComparator, values []any) (compiledQuery, error) {
	switch comparator {
	case QueryEqual, QueryNotEqual, QueryLess, QueryLessOrEqual, QueryGreater, QueryGreaterEqual:
		operators := map[QueryComparator]string{
			QueryEqual: "=", QueryNotEqual: "<>", QueryLess: "<", QueryLessOrEqual: "<=",
			QueryGreater: ">", QueryGreaterEqual: ">=",
		}
		return compiledQuery{sql: column + " " + operators[comparator] + " ?", args: values}, nil
	case QueryIn, QueryNotIn:
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(values)), ",")
		operator := "IN"
		if comparator == QueryNotIn {
			operator = "NOT IN"
		}
		return compiledQuery{sql: column + " " + operator + " (" + placeholders + ")", args: values}, nil
	case QueryContains, QueryStartsWith:
		text, ok := values[0].(string)
		if !ok {
			return compiledQuery{}, errors.New("flashcard text query requires a string")
		}
		pattern := "%" + escapeLike(text) + "%"
		if comparator == QueryStartsWith {
			pattern = escapeLike(text) + "%"
		}
		return compiledQuery{sql: column + ` LIKE ? ESCAPE '\'`, args: []any{pattern}}, nil
	default:
		return compiledQuery{}, fmt.Errorf("unsupported flashcard query comparator [%s]", comparator)
	}
}

func decodeQueryValues(raw json.RawMessage, array bool) ([]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if array {
		values, ok := value.([]any)
		if !ok || len(values) == 0 {
			return nil, errors.New("flashcard query requires a nonempty value array")
		}
		return values, nil
	}
	return []any{value}, nil
}

func decodeQueryBool(raw json.RawMessage) (bool, error) {
	values, err := decodeQueryValues(raw, false)
	if err != nil {
		return false, err
	}
	return queryBool(values[0])
}

func queryBool(value any) (bool, error) {
	boolean, ok := value.(bool)
	if !ok {
		return false, errors.New("flashcard query value is not a boolean")
	}
	return boolean, nil
}

func queryNumber(value any) (any, error) {
	number, ok := value.(json.Number)
	if !ok {
		return nil, errors.New("flashcard query value is not a number")
	}
	if integer, err := number.Int64(); err == nil {
		return integer, nil
	}
	decimal, err := number.Float64()
	if err != nil {
		return nil, err
	}
	return decimal, nil
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	return strings.ReplaceAll(value, `_`, `\_`)
}
