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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const maxStatisticsFutureDays = 3650

// StatisticsBucket 指定历史统计的时间粒度。
type StatisticsBucket string

const (
	StatisticsBucketDay   StatisticsBucket = "day"
	StatisticsBucketWeek  StatisticsBucket = "week"
	StatisticsBucketMonth StatisticsBucket = "month"
)

// StatisticsRequest 描述全局、复习集、查询或指定卡片的统计范围。
type StatisticsRequest struct {
	ReviewSetID           string           `json:"reviewSetID,omitempty"`
	Query                 *QueryAST        `json:"query,omitempty"`
	CardIDs               []string         `json:"cardIDs,omitempty"`
	From                  int64            `json:"from,omitempty"`
	To                    int64            `json:"to,omitempty"`
	Now                   int64            `json:"now"`
	Bucket                StatisticsBucket `json:"bucket"`
	TimezoneOffsetMinutes int              `json:"timezoneOffsetMinutes"`
	FutureDays            int              `json:"futureDays"`
}

// StatisticsOverview 汇总当前卡片的排期状态和可用性状态。
type StatisticsOverview struct {
	CurrentCards       int            `json:"currentCards"`
	DeletedCards       int            `json:"deletedCards"`
	ReviewStates       map[string]int `json:"reviewStates"`
	GenerationStatuses map[string]int `json:"generationStatuses"`
	Suspended          int            `json:"suspended"`
	Buried             int            `json:"buried"`
	Paused             int            `json:"paused"`
	Leeches            int            `json:"leeches"`
}

// StatisticsHistory 汇总指定历史时间范围内的复习表现。
type StatisticsHistory struct {
	Reviews           int            `json:"reviews"`
	UniqueCards       int            `json:"uniqueCards"`
	Ratings           map[string]int `json:"ratings"`
	Correct           int            `json:"correct"`
	Lapses            int            `json:"lapses"`
	Accuracy          float64        `json:"accuracy"`
	TrueRetention     float64        `json:"trueRetention"`
	RetentionReviews  int            `json:"retentionReviews"`
	DurationTotalMS   int64          `json:"durationTotalMS"`
	DurationKnown     int            `json:"durationKnown"`
	DurationUnknown   int            `json:"durationUnknown"`
	AverageDurationMS *float64       `json:"averageDurationMS,omitempty"`
}

// StatisticsTimePoint 保存一个本地日、周或月的复习汇总。
type StatisticsTimePoint struct {
	Start           int64 `json:"start"`
	Reviews         int   `json:"reviews"`
	UniqueCards     int   `json:"uniqueCards"`
	Correct         int   `json:"correct"`
	DurationTotalMS int64 `json:"durationTotalMS"`
	DurationKnown   int   `json:"durationKnown"`
}

// StatisticsHourPoint 保存本地小时维度的复习表现。
type StatisticsHourPoint struct {
	Hour      int     `json:"hour"`
	Reviews   int     `json:"reviews"`
	Correct   int     `json:"correct"`
	Retention float64 `json:"retention"`
}

// StatisticsDuePoint 保存一个本地自然日的预计到期量。
type StatisticsDuePoint struct {
	Start int64 `json:"start"`
	Cards int   `json:"cards"`
}

// StatisticsDistributionPoint 保存一个有序数值区间。
type StatisticsDistributionPoint struct {
	Label string  `json:"label"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Count int     `json:"count"`
}

// StatisticsResult 返回当前状态、历史、未来负荷和 FSRS 分布。
type StatisticsResult struct {
	Scope                      string                        `json:"scope"`
	From                       int64                         `json:"from"`
	To                         int64                         `json:"to"`
	Overview                   StatisticsOverview            `json:"overview"`
	History                    StatisticsHistory             `json:"history"`
	Series                     []StatisticsTimePoint         `json:"series"`
	ByHour                     []StatisticsHourPoint         `json:"byHour"`
	Overdue                    int                           `json:"overdue"`
	FutureDue                  []StatisticsDuePoint          `json:"futureDue"`
	IntervalDistribution       []StatisticsDistributionPoint `json:"intervalDistribution"`
	StabilityDistribution      []StatisticsDistributionPoint `json:"stabilityDistribution"`
	DifficultyDistribution     []StatisticsDistributionPoint `json:"difficultyDistribution"`
	RetrievabilityDistribution []StatisticsDistributionPoint `json:"retrievabilityDistribution"`
}

type statisticsReview struct {
	CardID     string
	Kind       string
	Rating     ReviewRating
	ReviewedAt int64
	DurationMS sql.NullInt64
	ReviewMode string
	Before     *ReviewStateSnapshot
	After      *ReviewStateSnapshot
}

type statisticsAccumulator struct {
	point StatisticsTimePoint
	cards map[string]struct{}
}

// Statistics 计算可重建 SQLite 投影上的完整闪卡统计。
func (projection *Projection) Statistics(ctx context.Context, request StatisticsRequest) (StatisticsResult, error) {
	request, err := normalizeStatisticsRequest(request)
	if err != nil {
		return StatisticsResult{}, err
	}
	current, scopeIDs, scope, err := projection.resolveStatisticsScope(ctx, request)
	if err != nil {
		return StatisticsResult{}, err
	}
	result := newStatisticsResult(request, scope)
	if err = projection.collectCurrentStatistics(ctx, request, current, scopeIDs, &result); err != nil {
		return StatisticsResult{}, err
	}
	reviews, err := projection.statisticsReviews(ctx, request.From, request.To, scopeIDs)
	if err != nil {
		return StatisticsResult{}, err
	}
	collectReviewStatistics(request, reviews, &result)
	return result, nil
}

func normalizeStatisticsRequest(request StatisticsRequest) (StatisticsRequest, error) {
	if request.Now <= 0 || request.From < 0 || request.To < 0 || request.FutureDays < 0 ||
		request.FutureDays > maxStatisticsFutureDays || request.TimezoneOffsetMinutes < -14*60 ||
		request.TimezoneOffsetMinutes > 14*60 {
		return request, errors.New("flashcard statistics request is invalid")
	}
	if len(request.CardIDs) != 0 && (strings.TrimSpace(request.ReviewSetID) != "" || request.Query != nil) {
		return request, errors.New("flashcard statistics accepts only one scope")
	}
	if request.Bucket == "" {
		request.Bucket = StatisticsBucketDay
	}
	if request.Bucket != StatisticsBucketDay && request.Bucket != StatisticsBucketWeek &&
		request.Bucket != StatisticsBucketMonth {
		return request, fmt.Errorf("unsupported flashcard statistics bucket [%s]", request.Bucket)
	}
	if request.To == 0 {
		request.To = request.Now + 1
	}
	if request.To <= request.From {
		return request, errors.New("flashcard statistics time range is invalid")
	}
	if request.FutureDays == 0 {
		request.FutureDays = 30
	}
	seen := map[string]struct{}{}
	for _, cardID := range request.CardIDs {
		if strings.TrimSpace(cardID) == "" {
			return request, errors.New("flashcard statistics card ID is required")
		}
		if _, duplicate := seen[cardID]; duplicate {
			return request, fmt.Errorf("duplicate flashcard statistics card [%s]", cardID)
		}
		seen[cardID] = struct{}{}
	}
	return request, nil
}

func (projection *Projection) resolveStatisticsScope(ctx context.Context, request StatisticsRequest) (
	[]CardSearchResult, map[string]struct{}, string, error) {
	options := CardSearchOptions{Now: request.Now, IncludeInactive: true, IncludeSuspended: true,
		IncludeBuried: true, IncludePaused: true}
	var current []CardSearchResult
	var err error
	scope := "global"
	if request.ReviewSetID != "" {
		scope = "reviewSet"
		var cardIDs []string
		cardIDs, err = projection.ReviewSetCardIDs(ctx, request.ReviewSetID, options)
		if err != nil {
			return nil, nil, "", err
		}
		requested := stringSet(cardIDs)
		current, err = projection.SearchCards(ctx, request.Query, options)
		current = filterCardSearchResults(current, requested)
	} else if request.Query != nil {
		scope = "query"
		current, err = projection.SearchCards(ctx, request.Query, options)
	} else if len(request.CardIDs) != 0 {
		scope = "cards"
		requested := stringSet(request.CardIDs)
		current, err = projection.SearchCards(ctx, nil, options)
		current = filterCardSearchResults(current, requested)
	} else {
		current, err = projection.SearchCards(ctx, nil, options)
	}
	if err != nil {
		return nil, nil, "", err
	}
	if scope == "global" {
		return current, nil, scope, nil
	}
	ids := make(map[string]struct{}, len(current))
	for _, card := range current {
		ids[card.Card.ID] = struct{}{}
	}
	return current, ids, scope, nil
}

func stringSet(values []string) map[string]struct{} {
	ret := make(map[string]struct{}, len(values))
	for _, value := range values {
		ret[value] = struct{}{}
	}
	return ret
}

func filterCardSearchResults(results []CardSearchResult, ids map[string]struct{}) []CardSearchResult {
	ret := make([]CardSearchResult, 0, len(ids))
	for _, result := range results {
		if _, found := ids[result.Card.ID]; found {
			ret = append(ret, result)
		}
	}
	return ret
}

func newStatisticsResult(request StatisticsRequest, scope string) StatisticsResult {
	ratings := map[string]int{string(ReviewAgain): 0, string(ReviewHard): 0, string(ReviewGood): 0,
		string(ReviewEasy): 0}
	byHour := make([]StatisticsHourPoint, 24)
	for hour := range byHour {
		byHour[hour].Hour = hour
	}
	return StatisticsResult{
		Scope: scope, From: request.From, To: request.To,
		Overview: StatisticsOverview{ReviewStates: map[string]int{"new": 0, "learning": 0, "review": 0,
			"relearning": 0}, GenerationStatuses: map[string]int{string(GenerationActive): 0,
			string(GenerationDisabledByTemplate): 0, string(GenerationOrphaned): 0, string(GenerationDeleted): 0}},
		History: StatisticsHistory{Ratings: ratings}, Series: []StatisticsTimePoint{}, ByHour: byHour,
		FutureDue: []StatisticsDuePoint{}, IntervalDistribution: intervalStatisticsDistribution(),
		StabilityDistribution:      stabilityStatisticsDistribution(),
		DifficultyDistribution:     difficultyStatisticsDistribution(),
		RetrievabilityDistribution: retrievabilityStatisticsDistribution(),
	}
}

func (projection *Projection) collectCurrentStatistics(ctx context.Context, request StatisticsRequest,
	current []CardSearchResult, scopeIDs map[string]struct{}, result *StatisticsResult) error {
	result.Overview.CurrentCards = len(current)
	if scopeIDs == nil {
		if err := projection.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM entities WHERE entity_type = ? AND deleted = 1`, EntityCard).
			Scan(&result.Overview.DeletedCards); err != nil {
			return fmt.Errorf("count deleted flashcards: %w", err)
		}
	}
	location := statisticsLocation(request.TimezoneOffsetMinutes)
	futureStart := startOfStatisticsDay(time.UnixMilli(request.Now).In(location))
	futureEnd := futureStart.AddDate(0, 0, request.FutureDays)
	futureCounts := make(map[int64]int)
	eligible, err := projection.SearchCards(ctx, nil, CardSearchOptions{Now: request.Now})
	if err != nil {
		return err
	}
	eligibleIDs := make(map[string]struct{}, len(eligible))
	for _, card := range eligible {
		eligibleIDs[card.Card.ID] = struct{}{}
	}
	presetThresholds := map[string]int{}
	for _, item := range current {
		state := item.ReviewState
		result.Overview.ReviewStates[state.State]++
		result.Overview.GenerationStatuses[string(item.Card.GenerationStatus)]++
		if state.Suspended {
			result.Overview.Suspended++
		}
		if state.BuriedUntil > request.Now {
			result.Overview.Buried++
		}
		if item.EffectivePriority == "paused" {
			result.Overview.Paused++
		}
		threshold, thresholdErr := projection.statisticsLeechThreshold(ctx, item, presetThresholds)
		if thresholdErr != nil {
			return thresholdErr
		}
		if threshold > 0 && int(state.Lapses) >= threshold {
			result.Overview.Leeches++
		}
		incrementStatisticsDistribution(result.IntervalDistribution, float64(state.ScheduledDays))
		incrementStatisticsDistribution(result.StabilityDistribution, state.Stability)
		incrementStatisticsDistribution(result.DifficultyDistribution, state.Difficulty)
		incrementStatisticsDistribution(result.RetrievabilityDistribution,
			statisticsRetrievability(state.ReviewStateSnapshot, request.Now))
		if _, available := eligibleIDs[item.Card.ID]; !available {
			continue
		}
		if state.Due < request.Now {
			result.Overdue++
		}
		due := time.UnixMilli(state.Due).In(location)
		if !due.Before(futureStart) && due.Before(futureEnd) {
			futureCounts[startOfStatisticsDay(due).UnixMilli()]++
		}
	}
	for day := futureStart; day.Before(futureEnd); day = day.AddDate(0, 0, 1) {
		start := day.UnixMilli()
		result.FutureDue = append(result.FutureDue, StatisticsDuePoint{Start: start, Cards: futureCounts[start]})
	}
	return nil
}

func (projection *Projection) statisticsLeechThreshold(ctx context.Context, item CardSearchResult,
	cache map[string]int) (int, error) {
	presetID := item.Card.PresetOverrideID
	if presetID == "" {
		presetID = item.DefaultPresetID
	}
	if presetID == "" {
		return 8, nil
	}
	if threshold, found := cache[presetID]; found {
		return threshold, nil
	}
	revision, found, err := projection.CurrentEntity(ctx, EntitySchedulerPreset, presetID)
	if err != nil {
		return 0, err
	}
	if !found || revision.Deleted {
		cache[presetID] = 8
		return 8, nil
	}
	var preset SchedulerPreset
	if err = decodeStrictJSON(revision.Payload, &preset); err != nil {
		return 0, err
	}
	cache[presetID] = preset.LeechThreshold
	return preset.LeechThreshold, nil
}

func (projection *Projection) statisticsReviews(ctx context.Context, from, to int64,
	scopeIDs map[string]struct{}) ([]statisticsReview, error) {
	undone, err := projection.undoneReviewEventIDs(ctx, "")
	if err != nil {
		return nil, err
	}
	rows, err := projection.db.QueryContext(ctx, `SELECT event_id, card_id, kind, rating, reviewed_at, duration_ms,
		review_mode, before_state, after_state
		FROM review_events WHERE reviewed_at >= ? AND reviewed_at < ? ORDER BY reviewed_at, event_id`, from, to)
	if err != nil {
		return nil, fmt.Errorf("query flashcard statistics reviews: %w", err)
	}
	defer rows.Close()
	ret := make([]statisticsReview, 0)
	for rows.Next() {
		var review statisticsReview
		var eventID string
		var beforePayload, afterPayload []byte
		if err = rows.Scan(&eventID, &review.CardID, &review.Kind, &review.Rating, &review.ReviewedAt, &review.DurationMS,
			&review.ReviewMode, &beforePayload, &afterPayload); err != nil {
			return nil, fmt.Errorf("scan flashcard statistics review: %w", err)
		}
		if _, found := undone[eventID]; found {
			continue
		}
		if len(beforePayload) != 0 {
			review.Before = &ReviewStateSnapshot{}
			if err = decodeStrictJSON(beforePayload, review.Before); err != nil {
				return nil, err
			}
		}
		if len(afterPayload) != 0 {
			review.After = &ReviewStateSnapshot{}
			if err = decodeStrictJSON(afterPayload, review.After); err != nil {
				return nil, err
			}
		}
		if scopeIDs != nil {
			if _, found := scopeIDs[review.CardID]; !found {
				continue
			}
		}
		ret = append(ret, review)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate flashcard statistics reviews: %w", err)
	}
	return ret, nil
}

func collectReviewStatistics(request StatisticsRequest, reviews []statisticsReview, result *StatisticsResult) {
	location := statisticsLocation(request.TimezoneOffsetMinutes)
	uniqueCards := map[string]struct{}{}
	series := map[int64]*statisticsAccumulator{}
	retentionCorrect := 0
	for _, review := range reviews {
		if review.Kind != "review" {
			continue
		}
		result.History.Reviews++
		uniqueCards[review.CardID] = struct{}{}
		correct := review.Rating == ReviewHard || review.Rating == ReviewGood || review.Rating == ReviewEasy
		if _, found := result.History.Ratings[string(review.Rating)]; found {
			result.History.Ratings[string(review.Rating)]++
		}
		if correct {
			result.History.Correct++
		}
		if review.After != nil && review.Before != nil && review.After.Lapses > review.Before.Lapses {
			result.History.Lapses += int(review.After.Lapses - review.Before.Lapses)
		} else if review.Rating == ReviewAgain && (review.Before == nil || review.Before.State == "review" ||
			review.Before.State == "relearning") {
			result.History.Lapses++
		}
		retentionEligible := review.ReviewMode == "normal" && (review.Before == nil ||
			review.Before.State == "review" || review.Before.State == "relearning")
		if retentionEligible {
			result.History.RetentionReviews++
			if correct {
				retentionCorrect++
			}
		}
		if review.DurationMS.Valid {
			result.History.DurationKnown++
			result.History.DurationTotalMS += review.DurationMS.Int64
		} else {
			result.History.DurationUnknown++
		}
		local := time.UnixMilli(review.ReviewedAt).In(location)
		hour := local.Hour()
		result.ByHour[hour].Reviews++
		if correct {
			result.ByHour[hour].Correct++
		}
		start := startOfStatisticsBucket(local, request.Bucket).UnixMilli()
		accumulator := series[start]
		if accumulator == nil {
			accumulator = &statisticsAccumulator{point: StatisticsTimePoint{Start: start}, cards: map[string]struct{}{}}
			series[start] = accumulator
		}
		accumulator.point.Reviews++
		accumulator.cards[review.CardID] = struct{}{}
		if correct {
			accumulator.point.Correct++
		}
		if review.DurationMS.Valid {
			accumulator.point.DurationKnown++
			accumulator.point.DurationTotalMS += review.DurationMS.Int64
		}
	}
	result.History.UniqueCards = len(uniqueCards)
	if result.History.Reviews > 0 {
		result.History.Accuracy = float64(result.History.Correct) / float64(result.History.Reviews)
	}
	if result.History.RetentionReviews > 0 {
		result.History.TrueRetention = float64(retentionCorrect) / float64(result.History.RetentionReviews)
	}
	if result.History.DurationKnown > 0 {
		average := float64(result.History.DurationTotalMS) / float64(result.History.DurationKnown)
		result.History.AverageDurationMS = &average
	}
	for hour := range result.ByHour {
		point := &result.ByHour[hour]
		if point.Reviews > 0 {
			point.Retention = float64(point.Correct) / float64(point.Reviews)
		}
	}
	starts := make([]int64, 0, len(series))
	for start := range series {
		starts = append(starts, start)
	}
	sort.Slice(starts, func(i, j int) bool { return starts[i] < starts[j] })
	for _, start := range starts {
		accumulator := series[start]
		accumulator.point.UniqueCards = len(accumulator.cards)
		result.Series = append(result.Series, accumulator.point)
	}
}

func statisticsLocation(offsetMinutes int) *time.Location {
	return time.FixedZone("flashcard-statistics", offsetMinutes*60)
}

func startOfStatisticsDay(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func startOfStatisticsBucket(value time.Time, bucket StatisticsBucket) time.Time {
	day := startOfStatisticsDay(value)
	switch bucket {
	case StatisticsBucketWeek:
		weekday := (int(day.Weekday()) + 6) % 7
		return day.AddDate(0, 0, -weekday)
	case StatisticsBucketMonth:
		return time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, day.Location())
	default:
		return day
	}
}

func statisticsRetrievability(state ReviewStateSnapshot, now int64) float64 {
	return projectedRetrievability(state.State, state.LastReview, state.Stability, now)
}

func intervalStatisticsDistribution() []StatisticsDistributionPoint {
	return []StatisticsDistributionPoint{{Label: "0", Min: 0, Max: 1}, {Label: "1", Min: 1, Max: 2},
		{Label: "2-6", Min: 2, Max: 7}, {Label: "7-29", Min: 7, Max: 30},
		{Label: "30-89", Min: 30, Max: 90}, {Label: "90-364", Min: 90, Max: 365},
		{Label: "365+", Min: 365, Max: math.Inf(1)}}
}

func stabilityStatisticsDistribution() []StatisticsDistributionPoint {
	return []StatisticsDistributionPoint{{Label: "0-1", Min: 0, Max: 1}, {Label: "1-7", Min: 1, Max: 7},
		{Label: "7-30", Min: 7, Max: 30}, {Label: "30-90", Min: 30, Max: 90},
		{Label: "90-365", Min: 90, Max: 365}, {Label: "365+", Min: 365, Max: math.Inf(1)}}
}

func difficultyStatisticsDistribution() []StatisticsDistributionPoint {
	ret := make([]StatisticsDistributionPoint, 0, 10)
	for value := 1; value <= 10; value++ {
		ret = append(ret, StatisticsDistributionPoint{Label: fmt.Sprintf("%d", value), Min: float64(value),
			Max: float64(value + 1)})
	}
	return ret
}

func retrievabilityStatisticsDistribution() []StatisticsDistributionPoint {
	ret := make([]StatisticsDistributionPoint, 0, 10)
	for value := 0; value < 10; value++ {
		ret = append(ret, StatisticsDistributionPoint{Label: fmt.Sprintf("%d-%d%%", value*10, (value+1)*10),
			Min: float64(value) / 10, Max: float64(value+1) / 10})
	}
	return ret
}

func incrementStatisticsDistribution(distribution []StatisticsDistributionPoint, value float64) {
	for index := range distribution {
		point := &distribution[index]
		if value >= point.Min && (value < point.Max || index == len(distribution)-1 && value <= point.Max) {
			point.Count++
			return
		}
	}
}

// MarshalJSON 将无穷大的开放区间上界编码为空值，避免生成非法 JSON 数字。
func (point StatisticsDistributionPoint) MarshalJSON() ([]byte, error) {
	type alias StatisticsDistributionPoint
	if !math.IsInf(point.Max, 1) {
		return json.Marshal(alias(point))
	}
	return json.Marshal(struct {
		Label string   `json:"label"`
		Min   float64  `json:"min"`
		Max   *float64 `json:"max"`
		Count int      `json:"count"`
	}{Label: point.Label, Min: point.Min, Count: point.Count})
}
