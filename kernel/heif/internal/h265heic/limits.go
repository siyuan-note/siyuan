package heic

import "github.com/gen2brain/h265/hevc"

const codedPixelSlack = 64 * 64

type limitBits struct {
	data []byte
	pos  int
	err  bool
}

func (r *limitBits) bit() uint32 {
	if r.pos >= len(r.data)*8 {
		r.err = true
		return 0
	}
	value := uint32(r.data[r.pos/8] >> (7 - r.pos%8) & 1)
	r.pos++
	return value
}

func (r *limitBits) bits(count int) uint32 {
	if count < 0 || count > 32 || count > len(r.data)*8-r.pos {
		r.err = true
		return 0
	}
	var value uint32
	for range count {
		value = value<<1 | r.bit()
	}
	return value
}

func (r *limitBits) skip(count int) {
	if count < 0 || count > len(r.data)*8-r.pos {
		r.err = true
		return
	}
	r.pos += count
}

func (r *limitBits) ue() uint32 {
	zeros := 0
	for r.bit() == 0 {
		zeros++
		if r.err || zeros > 31 {
			r.err = true
			return 0
		}
	}
	if zeros == 0 {
		return 0
	}
	return 1<<zeros - 1 + r.bits(zeros)
}

type spsLimits struct {
	width           uint32
	height          uint32
	chromaFormat    uint32
	bitDepthLuma    uint32
	bitDepthChroma  uint32
	confWinLeft     uint32
	confWinRight    uint32
	confWinTop      uint32
	confWinBottom   uint32
	separateColours bool
}

// inspectSPSLimits 只解析分配图像内存前所需的 SPS 字段。
func inspectSPSLimits(rbsp []byte) (spsLimits, error) {
	r := &limitBits{data: rbsp}
	r.skip(4)
	maxSubLayersMinus1 := int(r.bits(3))
	if maxSubLayersMinus1 > 6 {
		return spsLimits{}, ErrInvalid
	}
	r.skip(1)

	// general_profile_tier_level 和各子层声明均为定长字段。
	r.skip(2 + 1 + 5 + 32 + 48 + 8)
	profilePresent := make([]bool, maxSubLayersMinus1)
	levelPresent := make([]bool, maxSubLayersMinus1)
	for i := range maxSubLayersMinus1 {
		profilePresent[i] = r.bit() != 0
		levelPresent[i] = r.bit() != 0
	}
	if maxSubLayersMinus1 > 0 {
		r.skip(2 * (8 - maxSubLayersMinus1))
	}
	for i := range maxSubLayersMinus1 {
		if profilePresent[i] {
			r.skip(88)
		}
		if levelPresent[i] {
			r.skip(8)
		}
	}

	r.ue() // sps_seq_parameter_set_id
	limits := spsLimits{chromaFormat: r.ue()}
	if limits.chromaFormat > 3 {
		return spsLimits{}, ErrInvalid
	}
	if limits.chromaFormat == 3 {
		limits.separateColours = r.bit() != 0
	}
	limits.width = r.ue()
	limits.height = r.ue()
	if r.bit() != 0 {
		limits.confWinLeft = r.ue()
		limits.confWinRight = r.ue()
		limits.confWinTop = r.ue()
		limits.confWinBottom = r.ue()
	}
	limits.bitDepthLuma = r.ue() + 8
	limits.bitDepthChroma = r.ue() + 8
	if r.err || limits.width == 0 || limits.height == 0 {
		return spsLimits{}, ErrInvalid
	}
	return limits, nil
}

func validateSPSLimits(nal hevc.NALUnit, frameSizeLimit int) error {
	limits, err := inspectSPSLimits(nal.RBSP)
	if err != nil {
		return err
	}
	return validateParsedSPSLimits(limits, frameSizeLimit)
}

func validateParsedSPSLimits(limits spsLimits, frameSizeLimit int) error {
	if limits.separateColours || limits.chromaFormat > 1 ||
		limits.bitDepthLuma > 10 || limits.bitDepthChroma > 10 ||
		limits.bitDepthLuma != limits.bitDepthChroma {
		return ErrUnsupported
	}
	if frameSizeLimit <= 0 || uint64(limits.width)*uint64(limits.height) > uint64(frameSizeLimit) {
		return ErrUnsupported
	}
	subWidth, subHeight := uint64(1), uint64(1)
	if limits.chromaFormat == 1 {
		subWidth, subHeight = 2, 2
	}
	croppedWidth := subWidth * (uint64(limits.confWinLeft) + uint64(limits.confWinRight))
	croppedHeight := subHeight * (uint64(limits.confWinTop) + uint64(limits.confWinBottom))
	if croppedWidth >= uint64(limits.width) || croppedHeight >= uint64(limits.height) {
		return ErrUnsupported
	}
	return nil
}

func codedFrameLimit(displayPixels uint64, globalLimit int) int {
	if globalLimit <= 0 || displayPixels == 0 {
		return 0
	}
	if displayPixels >= uint64(globalLimit) {
		return globalLimit
	}
	limit := displayPixels + codedPixelSlack
	if doubled := displayPixels * 2; doubled > limit {
		limit = doubled
	}
	if limit > uint64(globalLimit) {
		limit = uint64(globalLimit)
	}
	return int(limit)
}
