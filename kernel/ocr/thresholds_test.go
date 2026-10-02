package ocr

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func TestOCRThresholdFiltering(t *testing.T) {
	base := modelConfig{}
	base.PostProcess.Threshold, base.PostProcess.BoxThreshold, base.PostProcess.Unclip = 0.3, 0.6, 1.5
	output := tensor{data: make([]float32, 100), shape: []int64{1, 1, 10, 10}}
	for y := 2; y < 8; y++ {
		for x := 2; x < 8; x++ {
			output.data[y*10+x] = 0.7
		}
	}
	high := 0.8
	for _, test := range []struct {
		name       string
		thresholds Thresholds
		boxes      int
	}{
		{"model defaults", Thresholds{}, 1},
		{"detection removes weak pixels", Thresholds{Detection: &high}, 0},
		{"box removes weak regions", Thresholds{Box: &high}, 0},
		{"reset restores regions", Thresholds{}, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			boxes, err := detectBoxes(output, 100, 100, test.thresholds.detectionConfig(base))
			if err != nil || len(boxes) != test.boxes {
				t.Fatalf("boxes=%v err=%v", boxes, err)
			}
		})
	}
	if base.PostProcess.Threshold != 0.3 || base.PostProcess.BoxThreshold != 0.6 {
		t.Fatal("overrides mutated model defaults")
	}
	defaults, strict := Thresholds{}, Thresholds{Recognition: &high}
	if !defaults.accepts("text", 0.5) || defaults.accepts("text", 0.49) || strict.accepts("text", 0.7) || !strict.accepts("text", 0.8) || strict.accepts(" \n", 1) {
		t.Fatal("recognition confidence or empty-text filtering failed")
	}
}

func TestOCRThresholdValidation(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), -0.1, 1.1, 0, 1} {
		for _, options := range []Thresholds{{Detection: &value}, {Box: &value}} {
			if options.Validate() == nil {
				t.Fatalf("accepted invalid detector threshold %v", value)
			}
		}
		err := (Thresholds{Recognition: &value}).Validate()
		if (err == nil) != (value == 0 || value == 1) {
			t.Fatalf("recognition threshold %v: %v", value, err)
		}
	}
	value := 0.7
	if err := (Thresholds{Detection: &value, Box: &value, Recognition: &value}).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestOCRWorkerThresholdRoundTrip(t *testing.T) {
	detection, box, recognition := 0.4, 0.7, 0.9
	request := WorkerRequest{Config: PaddleConfig{Directory: "model", Thresholds: Thresholds{Detection: &detection, Box: &box, Recognition: &recognition}}, Image: "image.png"}
	data, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var decoded WorkerRequest
	if err = json.Unmarshal(data, &decoded); err != nil || !reflect.DeepEqual(request, decoded) {
		t.Fatalf("worker lost thresholds: %+v, %v", decoded, err)
	}
}
