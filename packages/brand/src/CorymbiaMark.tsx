import React from 'react'
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg'
import { ramp } from '@corymbia/tokens'
import { MARK_PATH } from './markPath'

/** Offsets are artwork geometry; colours come from the tokens. */
const STOP_OFFSETS = ['0', '0.1666', '0.4994', '0.9638', '1'] as const

export const BRAND_GRADIENT_STOPS = STOP_OFFSETS.map((offset, i) => ({
  offset,
  color: ramp.brandGradient[i] as string,
}))

/** The eight spore dots. Every fill is one of the four brand greens. */
const SPORES = [
  { cx: 378, cy: 805.96002, r: 39.82, fill: ramp.brand.grass },
  { cx: 293.82001, cy: 744.15997, r: 26.129999, fill: ramp.brand.lime },
  { cx: 309.51001, cy: 663.41998, r: 19.940001, fill: ramp.brand.lime },
  { cx: 745.02002, cy: 759.98999, r: 25.91, fill: ramp.brand.teal },
  { cx: 688.40997, cy: 814.45001, r: 19.57, fill: ramp.brand.teal },
  { cx: 537.57001, cy: 284.92001, r: 37.560001, fill: ramp.brand.mint },
  { cx: 584.82001, cy: 376.81, r: 30.68, fill: ramp.brand.mint },
  { cx: 523.03003, cy: 437.92999, r: 21.08, fill: ramp.brand.mint },
] as const

const VIEW_BOX = {
  // Full artwork height, ~6 units of horizontal breathing room either side. Verified
  // (by rasterising design/logo/logo.svg at 1500x1500 and measuring the non-transparent
  // bounding box) to contain the whole mark — see MEASURED_ARTWORK_BOUNDS in the test file.
  tight: '414 0 672 1500',
  square: '0 0 1500 1500',
} as const

/** width/height of each crop's viewBox, i.e. its true aspect ratio. */
const ASPECT = { tight: 672 / 1500, square: 1 } as const

export function CorymbiaMark({
  size = 26,
  crop = 'tight',
}: {
  size?: number
  crop?: 'tight' | 'square'
}) {
  return (
    <Svg
      testID="corymbia-mark"
      accessibilityRole="image"
      accessibilityLabel="Corymbia"
      width={size}
      height={size / ASPECT[crop]}
      viewBox={VIEW_BOX[crop]}
    >
      <Defs>
        <LinearGradient
          id="corymbiaMark"
          gradientUnits="userSpaceOnUse"
          x1="229.0778"
          y1="750"
          x2="748.66553"
          y2="750"
        >
          {BRAND_GRADIENT_STOPS.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </LinearGradient>
      </Defs>
      <G transform="matrix(1.2165365,0,0,1.2165365,141.72777,-162.40239)">
        {SPORES.map((s, i) => (
          <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} />
        ))}
        <Path fill="url(#corymbiaMark)" d={MARK_PATH} />
      </G>
    </Svg>
  )
}
