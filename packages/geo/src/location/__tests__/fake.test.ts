import { createFakeLocationSource } from '../fake'
import type { Reading } from '../../classify'

const reading = (accuracyM: number): Reading => ({
  latitude: -37.82141,
  longitude: 145.03318,
  accuracyM,
  altitudeM: 62,
  timestampMs: Date.now(),
})

describe('the fake location source', () => {
  it('grants permission by default, since that is the common path', async () => {
    expect(await createFakeLocationSource({}).requestPermission()).toBe('granted')
  })

  it('can be scripted to deny permission', async () => {
    const source = createFakeLocationSource({ permission: 'denied' })
    expect(await source.requestPermission()).toBe('denied')
  })

  it('reports no last-known position when scripted with none', async () => {
    expect(await createFakeLocationSource({}).getLastKnown()).toBeNull()
  })

  it('replays scripted readings to a watcher', async () => {
    const source = createFakeLocationSource({ readings: [reading(20), reading(9)] })
    const seen: number[] = []
    await source.watch((r) => seen.push(r.accuracyM))
    expect(seen).toEqual([20, 9])
  })

  it('emits further readings on demand, for tests that drive a hold', async () => {
    const source = createFakeLocationSource({})
    const seen: number[] = []
    await source.watch((r) => seen.push(r.accuracyM))
    source.emit(reading(6))
    source.emit(reading(4))
    expect(seen).toEqual([6, 4])
  })

  it('stops delivering readings once unsubscribed', async () => {
    const source = createFakeLocationSource({})
    const seen: number[] = []
    const stop = await source.watch((r) => seen.push(r.accuracyM))
    stop()
    source.emit(reading(4))
    expect(seen).toEqual([])
  })

  it('supports multiple concurrent watchers, each receiving emitted readings', async () => {
    const source = createFakeLocationSource({})
    const seenA: number[] = []
    const seenB: number[] = []
    await source.watch((r) => seenA.push(r.accuracyM))
    await source.watch((r) => seenB.push(r.accuracyM))
    source.emit(reading(7))
    expect(seenA).toEqual([7])
    expect(seenB).toEqual([7])
  })

  it("stopping one watcher leaves the other's subscription live", async () => {
    const source = createFakeLocationSource({})
    const seenA: number[] = []
    const seenB: number[] = []
    const stopA = await source.watch((r) => seenA.push(r.accuracyM))
    await source.watch((r) => seenB.push(r.accuracyM))
    stopA()
    source.emit(reading(3))
    expect(seenA).toEqual([])
    expect(seenB).toEqual([3])
  })
})
