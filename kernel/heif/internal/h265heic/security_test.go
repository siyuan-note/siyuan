package heic

import (
	"bytes"
	"errors"
	"image"
	"testing"

	"github.com/gen2brain/h265/hevc"
)

func TestDecodeConfigRejectsSequenceContainer(t *testing.T) {
	data := append(testBox("ftyp"), testBox("moov")...)
	if _, err := DecodeConfig(bytes.NewReader(data)); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected sequence error: %v", err)
	}
}

func TestOptionsClampResourceLimits(t *testing.T) {
	got := options([]Options{{FrameSizeLimit: DefaultFrameSizeLimit + 1, Threads: 8}})
	if got.FrameSizeLimit != DefaultFrameSizeLimit || got.Threads != 1 {
		t.Fatalf("unexpected options: %+v", got)
	}
	got = options([]Options{{FrameSizeLimit: -1}})
	if got.FrameSizeLimit != DefaultFrameSizeLimit || got.Threads != 1 {
		t.Fatalf("unexpected negative-limit options: %+v", got)
	}
}

func TestSPSLimitsRejectUnsafeCropAndMixedBitDepth(t *testing.T) {
	valid := spsLimits{
		width:          16,
		height:         16,
		chromaFormat:   1,
		bitDepthLuma:   8,
		bitDepthChroma: 8,
	}
	if err := validateParsedSPSLimits(valid, 256); err != nil {
		t.Fatalf("valid SPS limits were rejected: %v", err)
	}

	mixedDepth := valid
	mixedDepth.bitDepthChroma = 10
	if err := validateParsedSPSLimits(mixedDepth, 256); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected mixed bit-depth error: %v", err)
	}

	invalidCrop := valid
	invalidCrop.confWinLeft = 8
	if err := validateParsedSPSLimits(invalidCrop, 256); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected conformance-window error: %v", err)
	}
}

func TestParseRejectsOversizedContainerBeforeReading(t *testing.T) {
	src := &source{size: maxContainerBytes + 1}
	if _, err := parse(src); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected oversized-container error: %v", err)
	}
}

func TestEachHVCCStreamsOneNAL(t *testing.T) {
	data := []byte{0, 0, 0, 3, byte(hevc.NALIdrWRadl << 1), 1, 0x80}
	count := 0
	err := eachHVCC(data, 4, func(_ hevc.NALUnit) error {
		count++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("decoded %d NAL units", count)
	}
}

func TestItemDataLimitPrecedesRead(t *testing.T) {
	source := &source{size: maxItemDataBytes + 1}
	item := &item{extents: []extent{{len: maxItemDataBytes + 1}}}
	if _, err := (&metaBox{}).data(item, source); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected item data error: %v", err)
	}
}

func TestDecodedItemDataUsesSharedBudget(t *testing.T) {
	f := &file{}
	f.decodedBytes = maxItemDataBytes
	if err := f.consumeDecodedBytes(1); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected shared data-budget error: %v", err)
	}
}

func TestGridTileLimit(t *testing.T) {
	data := []byte{0, 0, 16, 16, 0, 1, 0, 1}
	if _, err := parseGrid(data); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected grid error: %v", err)
	}
}

func TestGridRejectsDuplicateTiles(t *testing.T) {
	if _, err := (&file{}).decodeTiles(gridInfo{}, []uint32{1, 1}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected duplicate tile error: %v", err)
	}
}

func TestTopLevelBoxLimit(t *testing.T) {
	data := make([]byte, 0, (maxTopLevelBoxes+1)*8)
	for range maxTopLevelBoxes + 1 {
		data = append(data, testBox("free")...)
	}
	if err := memSource(data).eachBox(func(string, uint64, uint64) error { return nil }); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unexpected top-level box error: %v", err)
	}
}

func TestTenBitPictureUsesEightBitOutput(t *testing.T) {
	picture := &hevc.Picture{
		Width:        2,
		Height:       2,
		CropW:        2,
		CropH:        2,
		ChromaFormat: 0,
		BitDepth:     10,
		BitDepthC:    10,
		Y16:          []uint16{0, 256, 512, 1023},
		StrideY:      2,
	}
	decoded, err := toImage(picture, nil, ColorInfo{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded.(*image.NRGBA); !ok {
		t.Fatalf("unexpected decoded image type: %T", decoded)
	}
}

func TestCombinedCropRotateAndMirror(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for i := range 6 {
		source.Pix[i*4] = uint8(i + 1)
		source.Pix[i*4+3] = 0xff
	}
	f := &file{meta: &metaBox{props: []property{
		{typ: "clap", clap: [8]uint32{1, 1, 2, 1, 0, 1, 0, 1}},
		{typ: "irot", angle: 1},
		{typ: "imir", axis: 1},
	}}}
	it := &item{props: []itemProp{{idx: 0}, {idx: 1}, {idx: 2}}}
	transformed, err := f.applyTransforms(source, it)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := transformed.(*image.NRGBA)
	if !ok {
		t.Fatalf("unexpected transformed image type: %T", transformed)
	}
	if got.Bounds().Dx() != 2 || got.Bounds().Dy() != 1 || got.Pix[0] != 5 || got.Pix[4] != 2 {
		t.Fatalf("unexpected transformed pixels: bounds=%v pix=%v", got.Bounds(), got.Pix)
	}
}

func testBox(name string) []byte {
	return []byte{0, 0, 0, 8, name[0], name[1], name[2], name[3]}
}
