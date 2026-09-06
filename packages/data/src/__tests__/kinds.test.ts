import { serialiseAttributes, validateAttributes } from '../kinds'

describe('record kind attributes', () => {
  it('accepts an empty object for a pin, which has no kind-specific fields yet', () => {
    expect(validateAttributes('pin', {})).toEqual({})
  })

  it('rejects a pin carrying unexpected attributes rather than silently storing them', () => {
    expect(() => validateAttributes('pin', { species: 'Eucalyptus' })).toThrow(/species/)
  })

  it('rejects a non-object', () => {
    expect(() => validateAttributes('pin', 'nope')).toThrow()
    expect(() => validateAttributes('pin', null)).toThrow()
  })

  it('rejects exotic objects like Date, RegExp, and class instances', () => {
    expect(() => validateAttributes('pin', new Date())).toThrow(/plain object/)
    expect(() => validateAttributes('pin', /regex/)).toThrow(/plain object/)

    class CustomClass {}
    expect(() => validateAttributes('pin', new CustomClass())).toThrow(/plain object/)
  })

  it('serialises to JSON ready for the attributes column', () => {
    expect(serialiseAttributes('pin', {})).toBe('{}')
  })
})
