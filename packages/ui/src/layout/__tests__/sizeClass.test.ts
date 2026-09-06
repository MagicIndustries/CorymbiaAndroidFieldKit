import { sizeClassFor } from '../sizeClass'

describe('sizeClassFor', () => {
  it('treats phones in portrait as compact', () => {
    // Galaxy S25 and S24 portrait are ~412dp wide.
    expect(sizeClassFor(412)).toBe('compact')
    expect(sizeClassFor(360)).toBe('compact')
  })

  it('treats a 10-inch tablet in portrait as medium', () => {
    expect(sizeClassFor(800)).toBe('medium')
    expect(sizeClassFor(600)).toBe('medium')
  })

  it('treats a 10-inch tablet in landscape as expanded', () => {
    expect(sizeClassFor(840)).toBe('expanded')
    expect(sizeClassFor(1280)).toBe('expanded')
  })

  it('uses inclusive lower bounds at the documented breakpoints', () => {
    expect(sizeClassFor(599)).toBe('compact')
    expect(sizeClassFor(839)).toBe('medium')
  })
})
