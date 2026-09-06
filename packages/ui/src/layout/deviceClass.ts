/**
 * What kind of device this is — answers "is this a phone or a tablet?",
 * which is orientation-*invariant*: a device that is a tablet in portrait is
 * still a tablet after rotating to landscape. Derived from the **shortest
 * side** in dp, the one measurement rotation never changes, with the
 * breakpoint at 600dp.
 *
 * Device class drives ergonomic decisions (see `resolveReach`) — a 10-inch
 * tablet held in two hands puts the thumbs near the corners and the centre
 * out of reach, regardless of which way it's held. It is deliberately kept
 * separate from `SizeClass`, which answers the orientation-*dependent*
 * "how much horizontal room is there right now?" question instead.
 */
export type DeviceClass = 'phone' | 'tablet'

export const DEVICE_BREAKPOINT = 600

export function deviceClassFor(shortestSideDp: number): DeviceClass {
  return shortestSideDp >= DEVICE_BREAKPOINT ? 'tablet' : 'phone'
}
