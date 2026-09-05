import React from 'react'
import { Type } from '../primitives/Type'

export type ProjectNameProps = {
  name: string
  testID?: string
}

/**
 * Hero treatment. Doctrine rule 10: clamps to two lines so the card never grows
 * and the primary action below it never moves. Doctrine rule 14: never animated.
 *
 * `shortLabel` is deliberately absent from `ProjectNameProps`, even though a
 * project record carries one alongside `name`. The hero has the room to show
 * the full name, so doctrine rule 12 (short label wherever space is tight)
 * does not apply here — `NameChip` is where `shortLabel` actually takes
 * effect. Adding `shortLabel?: string | null` back to this type to make
 * `<ProjectName {...project} />` "look right" would silently defeat
 * TypeScript's excess-property check: a caller who typos and writes
 * `<ProjectName name={p.name} shortLabel={p.shortLabel} />` would get no
 * feedback that the value does nothing. Leaving it out means that explicit
 * form fails to compile, while `<ProjectName {...project} />` (a spread,
 * which excess-property checking does not cover) still works fine — so the
 * one-record convenience survives and the typo footgun does not. Do not
 * re-add `shortLabel` to this type.
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
