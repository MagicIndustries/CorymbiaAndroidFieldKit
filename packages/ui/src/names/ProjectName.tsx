import React from 'react'
import { Type } from '../primitives/Type'

export type ProjectNameProps = {
  name: string
  /**
   * Accepted but deliberately unused here. Kept in the type so a caller
   * holding a `{ name, shortLabel }` pair from the data model can pass the
   * same props to `ProjectName` and `NameChip` without picking fields per
   * component. The hero treatment has the room to show the full name, so
   * doctrine rule 12 (short label wherever space is tight) does not apply —
   * `NameChip` is where `shortLabel` actually takes effect.
   */
  shortLabel?: string | null
  testID?: string
}

/**
 * Hero treatment. Doctrine rule 10: clamps to two lines so the card never grows
 * and the primary action below it never moves. Doctrine rule 14: never animated.
 */
export function ProjectName({ name, testID }: ProjectNameProps) {
  return (
    <Type
      testID={testID}
      variant="title"
      numberOfLines={2}
      ellipsizeMode="tail"
      accessibilityLabel={name}
    >
      {name}
    </Type>
  )
}
