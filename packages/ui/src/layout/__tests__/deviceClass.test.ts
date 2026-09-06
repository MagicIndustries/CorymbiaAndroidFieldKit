import { deviceClassFor } from '../deviceClass'

describe('deviceClassFor', () => {
  it('treats a shortest side under 600dp as a phone', () => {
    expect(deviceClassFor(412)).toBe('phone')
    expect(deviceClassFor(599)).toBe('phone')
  })

  it('treats a shortest side of 600dp and above as a tablet', () => {
    expect(deviceClassFor(600)).toBe('tablet')
    expect(deviceClassFor(800)).toBe('tablet')
  })

  it('is orientation-invariant: a 10-inch tablet is a tablet in both orientations', () => {
    // 800x1280dp portrait and 1280x800dp landscape share the same shortest
    // side, so rotation cannot change the answer — the bug this module
    // exists to prevent.
    expect(deviceClassFor(Math.min(800, 1280))).toBe('tablet')
    expect(deviceClassFor(Math.min(1280, 800))).toBe('tablet')
  })
})
