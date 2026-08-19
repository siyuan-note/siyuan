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
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestSetBazaarPackageRatingArgumentValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/rating", setBazaarPackageRating)

	for _, rating := range []any{-1, 1.5, 6, "5"} {
		body, err := json.Marshal(map[string]any{
			"packageType": "plugins",
			"packageName": "sample",
			"rating":      rating,
		})
		if nil != err {
			t.Fatal(err)
		}
		response := performBazaarRatingRequest(t, engine, body)
		if 0 == response.Code {
			t.Fatalf("expected rating %v to be rejected", rating)
		}
	}
}

func TestSetBazaarPackageRatingAcceptsCancellation(t *testing.T) {
	oldSetRating := setBazaarPackageRatingModel
	t.Cleanup(func() { setBazaarPackageRatingModel = oldSetRating })
	called := false
	setBazaarPackageRatingModel = func(_ context.Context, pkgType, packageName string,
		rating int) (*bazaar.PackageRating, bool, int, error) {
		called = true
		if "plugins" != pkgType || "sample" != packageName || 0 != rating {
			t.Fatalf("unexpected cancellation arguments: type=%s package=%s rating=%d", pkgType, packageName, rating)
		}
		return nil, true, 0, nil
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/rating", setBazaarPackageRating)
	body, err := json.Marshal(map[string]any{
		"packageType": "plugins",
		"packageName": "sample",
		"rating":      0,
	})
	if nil != err {
		t.Fatal(err)
	}
	response := performBazaarRatingRequest(t, engine, body)
	if 0 != response.Code || !called {
		t.Fatalf("cancellation was not accepted: response=%+v called=%v", response, called)
	}
}

func TestGetBazaarPackageRatingsRequiresPackageNames(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/rating", getBazaarPackageRatings)

	body, err := json.Marshal(map[string]any{"packageType": "plugins"})
	if nil != err {
		t.Fatal(err)
	}
	response := performBazaarRatingRequest(t, engine, body)
	if 0 == response.Code {
		t.Fatal("missing packageNames should be rejected")
	}
}

func TestBazaarPackageRatingsResponseEligibility(t *testing.T) {
	rating := &bazaar.PackageRating{Average: 5, Count: 1, Distribution: [5]int64{0, 0, 0, 0, 1}}
	data := bazaarPackageRatingsResponseData(map[string]*bazaar.PackageRating{"rated": rating},
		[]string{"rated", "official-zero"})
	ratings, ok := data["ratings"].(map[string]*bazaar.PackageRating)
	if !ok || ratings["rated"] != rating {
		t.Fatalf("unexpected ratings: %+v", data["ratings"])
	}
	eligiblePackageNames, ok := data["eligiblePackageNames"].([]string)
	if !ok || !slices.Equal([]string{"rated", "official-zero"}, eligiblePackageNames) {
		t.Fatalf("unexpected eligible package names: %+v", data["eligiblePackageNames"])
	}
}

func TestGetBazaarPackageUserRatings(t *testing.T) {
	oldGetUserRatings := getBazaarPackageUserRatingsModel
	t.Cleanup(func() { getBazaarPackageUserRatingsModel = oldGetUserRatings })
	getBazaarPackageUserRatingsModel = func(_ context.Context, pkgType string,
		packageNames []string) (map[string]int, []string, error) {
		if "plugins" != pkgType || !slices.Equal([]string{"rated", "unrated"}, packageNames) {
			t.Fatalf("unexpected request: type=%s names=%v", pkgType, packageNames)
		}
		return map[string]int{"rated": 4, "unrated": 0}, []string{"rated", "unrated"}, nil
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/rating", getBazaarPackageUserRatings)
	body, err := json.Marshal(map[string]any{
		"packageType":  "plugins",
		"packageNames": []string{"rated", "unrated"},
	})
	if nil != err {
		t.Fatal(err)
	}
	response := performBazaarRatingRequest(t, engine, body)
	if 0 != response.Code {
		t.Fatalf("unexpected response: %+v", response)
	}
	encoded, err := json.Marshal(response.Data)
	if nil != err {
		t.Fatal(err)
	}
	var data struct {
		UserRatings          map[string]int `json:"userRatings"`
		EligiblePackageNames []string       `json:"eligiblePackageNames"`
	}
	if err = json.Unmarshal(encoded, &data); nil != err {
		t.Fatal(err)
	}
	if !slices.Equal([]string{"rated", "unrated"}, data.EligiblePackageNames) ||
		4 != data.UserRatings["rated"] || 0 != data.UserRatings["unrated"] {
		t.Fatalf("unexpected response data: %+v", data)
	}
}

func TestGetBazaarPackageUserRatingsRequiresPackageNames(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/rating", getBazaarPackageUserRatings)

	body, err := json.Marshal(map[string]any{"packageType": "plugins"})
	if nil != err {
		t.Fatal(err)
	}
	response := performBazaarRatingRequest(t, engine, body)
	if 0 == response.Code {
		t.Fatal("missing packageNames should be rejected")
	}
}

func TestBazaarPackageRatingResponseAvailability(t *testing.T) {
	for _, test := range []struct {
		name            string
		rating          *bazaar.PackageRating
		ratingAvailable bool
	}{
		{name: "unavailable", ratingAvailable: false},
		{name: "available without ratings", ratingAvailable: true},
		{name: "available with rating", ratingAvailable: true, rating: &bazaar.PackageRating{Count: 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := bazaarPackageRatingResponseData(test.rating, test.ratingAvailable, 4)
			if data["ratingAvailable"] != test.ratingAvailable || data["userRating"] != 4 {
				t.Fatalf("unexpected response data: %+v", data)
			}
			_, hasRating := data["rating"]
			if hasRating != (nil != test.rating) {
				t.Fatalf("unexpected rating presence: %+v", data)
			}
		})
	}
}

func TestSetBazaarPackageRatingRateLimitedError(t *testing.T) {
	result := gulu.Ret.NewResult()
	setBazaarPackageRatingError(result, model.ErrBazaarRatingRateLimited)
	if 1 != result.Code {
		t.Fatalf("unexpected result code: %d", result.Code)
	}
	data, ok := result.Data.(map[string]any)
	if !ok || "bazaarRatingRateLimited" != data["errorCode"] {
		t.Fatalf("unexpected rate-limit response data: %+v", result.Data)
	}
}

func performBazaarRatingRequest(t *testing.T, engine *gin.Engine, body []byte) *gulu.Result {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/rating", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	result := gulu.Ret.NewResult()
	if err := json.Unmarshal(recorder.Body.Bytes(), result); nil != err {
		t.Fatal(err)
	}
	return result
}
