import React from 'react'
import { StyleSheet } from 'react-native'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { ThemeProvider } from '@corymbia/ui'
import { field } from '@corymbia/tokens'

/**
 * Tests for the camera screen (Plan 4, Task 8): the full-screen viewfinder
 * with our own shutter, reached from a record.
 *
 * WHAT IS AND IS NOT MOCKED, and why.
 *
 * Mocked: `expo-camera` itself. `CameraView` is a native view with no
 * meaningful behaviour in a headless test environment; what this screen owns
 * is which of its three permission states it shows, and what it does with
 * whatever `takePictureAsync` hands back — both are exercised by controlling
 * `useCameraPermissions`'s return value and `takePictureAsync`'s mock
 * directly, through `setPermission` and the fixtures below.
 *
 * Mocked: `../../src/media/attachPhoto`, the seam Task 10 fills in with the
 * real pipeline (file copy, media id, `attachMedia`). This screen's job is to
 * call it with the right arguments, handle its rejection on screen, and
 * navigate back on success — none of which needs a real file system or a
 * real database.
 *
 * Mocked: `../../src/db/provider`'s `useSettings`, for the one field
 * (`handedness`) this screen reads to resolve the reach zone — the same
 * value `capture.tsx` reads, through the same `resolveReach`, which is
 * exercised for real.
 *
 * Mocked: `expo-router`'s `router` singleton and `useLocalSearchParams`, so
 * navigation and the `recordId` param are observable without a real
 * navigation container.
 *
 * Not mocked: `resolveReach`, `@corymbia/ui`'s `Button`/`Screen`/`Type`, and
 * `ThemeProvider` — the actual rendering this screen is answerable for.
 */

// ---------------------------------------------------------------------------
// Module mocks. Every factory below reaches its fixtures through variables
// prefixed `mock`: Jest's module-factory hoisting only allows a `jest.mock`
// factory to close over out-of-scope identifiers whose name starts with
// "mock" (enforced by babel-plugin-jest-hoist), which is why every mutable
// fixture in this file — and in `capture.test.tsx`, `diagnostics.test.tsx` —
// is named that way rather than for readability's own sake. Where the
// brief's own tests read more naturally under an unprefixed name
// (`takePictureAsync`, `attachPhoto`, `routerBack`), a plain `const` alias is
// declared after the mock, never inside a factory.
// ---------------------------------------------------------------------------

const mockTakePictureAsync = jest.fn()
const mockRequestPermission = jest.fn()

type MockPermission = { granted: boolean; canAskAgain: boolean; status: string } | null
let mockPermission: MockPermission = null

jest.mock('expo-camera', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react')
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    // A `View` standing in for the native preview, exposing `takePictureAsync`
    // through its ref the way the real `CameraView` exposes its imperative
    // handle — `forwardRef` is required for that: a plain function component
    // cannot carry a ref at all.
    CameraView: ReactActual.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<{ takePictureAsync: typeof mockTakePictureAsync }>) => {
        ReactActual.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePictureAsync }))
        return ReactActual.createElement(RNView, props)
      },
    ),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  }
})

const mockAttachPhoto = jest.fn()

jest.mock('../../src/media/attachPhoto', () => ({
  attachPhoto: (...args: unknown[]) => mockAttachPhoto(...args),
}))

const mockSettings = {
  theme: 'dark' as const,
  handedness: 'right' as const,
  capturePrimary: 'saveNow' as const,
  density: 'comfortable' as const,
}
const mockUseSettings = { settings: mockSettings, updateSetting: () => Promise.resolve() }

jest.mock('../../src/db/provider', () => ({
  useSettings: () => mockUseSettings,
}))

const mockRouterBack = jest.fn()

// `let`, not a fixed literal: `attaches the captured photo to the record it
// was opened for` and the plumbing test right after it both depend on this
// being able to change between tests. A screen that quietly hardcoded
// 'rec_a' as the argument to `attachPhoto` would satisfy a test that only
// ever exercised one recordId — this is what lets a second value catch that.
let mockRecordId: string | undefined = 'rec_a'

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
  useLocalSearchParams: () => ({ recordId: mockRecordId }),
}))

// Imported after the mocks so it picks them up.
import CameraScreen from '../camera'

// Aliases matching the brief's own naming, declared after every mock above —
// never referenced from inside a `jest.mock` factory.
const takePictureAsync = mockTakePictureAsync
const attachPhoto = mockAttachPhoto
const routerBack = mockRouterBack
const requestPermission = mockRequestPermission

function setPermission(permission: MockPermission) {
  mockPermission = permission
}

const flatten = StyleSheet.flatten

async function renderScreen() {
  return render(
    <ThemeProvider initial="dark">
      <CameraScreen />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  mockPermission = null
  mockRecordId = 'rec_a'
  mockTakePictureAsync.mockReset()
  mockRequestPermission.mockReset()
  mockAttachPhoto.mockReset()
  mockRouterBack.mockClear()
})

describe('CameraScreen', () => {
  it('asks for the camera before showing a viewfinder', async () => {
    setPermission({ granted: false, canAskAgain: true, status: 'undetermined' })
    await renderScreen()
    expect(screen.getByTestId('camera-request')).toBeTruthy()
    expect(screen.queryByTestId('camera-view')).toBeNull()
  })

  it('asks the OS for camera access when the request button is pressed', async () => {
    // The one branch on this screen with a real side effect: pressing this
    // button and doing nothing are indistinguishable to every other
    // assertion in this file, which is exactly what makes it worth pinning
    // on its own.
    setPermission({ granted: false, canAskAgain: true, status: 'undetermined' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-request'))
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('shows neither the viewfinder nor a refusal while permission is still unknown', async () => {
    // `useCameraPermissions` returns null until it resolves. Treating null as
    // denied flashes "no camera access" at someone who granted it months ago.
    setPermission(null)
    await renderScreen()
    expect(screen.queryByTestId('camera-denied')).toBeNull()
    expect(screen.queryByTestId('camera-view')).toBeNull()
    // The third state, not just the two obvious ones: a null permission is
    // neither granted nor refused, so the *request* UI — correct only once
    // `canAskAgain` is known — must be absent here too, or someone who
    // granted access months ago sees "Allow camera access" flash up while
    // the hook is still resolving.
    expect(screen.queryByTestId('camera-request')).toBeNull()
  })

  it('explains what to do when permission was refused for good', async () => {
    setPermission({ granted: false, canAskAgain: false, status: 'denied' })
    await renderScreen()
    expect(screen.getByTestId('camera-denied')).toHaveTextContent(/settings/i)
  })

  it('shows the shutter once permission is granted', async () => {
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    expect(screen.getByTestId('camera-shutter')).toBeTruthy()
  })

  it('gives the shutter a field-sized target', async () => {
    // She is holding a phone one-handed over a plot, possibly gloved. This is
    // the same reason the capture control is `field.control` and not
    // `touch.min`.
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    const style = flatten(screen.getByTestId('camera-shutter').props.style)
    expect(style.minHeight).toBeGreaterThanOrEqual(field.control)
  })

  it('attaches the captured photo to the record it was opened for', async () => {
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg', width: 4, height: 3 })
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(attachPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'rec_a', sourceUri: 'file:///tmp/shot.jpg' }),
    )
    // `exif: true` is deliberate (spec §12.1): the image's own timestamp and
    // coordinates corroborate the record's fix, which matters for a photo
    // that may end up as evidence of what was at a site. Nothing else
    // asserted the option object, so deleting it left every other test
    // green.
    expect(takePictureAsync).toHaveBeenCalledWith({ quality: 0.85, exif: true })
  })

  it('attaches to a different record when opened for a different one', async () => {
    // The companion to the test above: a screen whose shoot handler hardcoded
    // 'rec_a' — rather than reading `useLocalSearchParams` — would pass that
    // one test just as well as real plumbing would. A second, different
    // value is what tells the two apart.
    mockRecordId = 'rec_b'
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/other.jpg', width: 4, height: 3 })
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(attachPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'rec_b', sourceUri: 'file:///tmp/other.jpg' }),
    )
  })

  it('ignores a second shutter press while the first is still saving', async () => {
    // The exact failure that killed the capture button in Plan 3: a claim
    // taken after an await is a claim taken too late. Two presses, one photo.
    //
    // Both presses are fired from the SAME rendered element, back to back,
    // inside one outer `act`, with no `await` between them. RNTL v14's
    // `fireEvent` awaits `act()` internally, so an `await` between two
    // presses lets `setSaving(true)` from the first flush and re-render
    // before the second press is even dispatched — at which point a state
    // guard (`if (saving) return`) reads the already-updated value and
    // blocks correctly too, making it indistinguishable from the ref guard
    // this screen actually uses. Not awaiting between them reproduces the
    // real hazard: two taps landing in the same frame, before React has had
    // a chance to re-render, which only the ref guard survives — a state
    // guard reads `saving` from the stale closure both times and lets both
    // presses through.
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    let release: (v: unknown) => void = () => {}
    takePictureAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderScreen()
    const shutter = screen.getByTestId('camera-shutter')
    // Two `fireEvent.press` calls on the SAME rendered element, inside one
    // outer `act`, with no `await` between them. `fireEvent.press` awaits
    // its own internal `act()` when awaited individually — that await is
    // exactly what lets `setSaving(true)` from the first press flush and
    // re-render before the second is even dispatched, at which point a
    // state guard reads the already-updated value and blocks correctly
    // too, indistinguishable from the ref guard this screen actually uses.
    // Nesting both calls inside one `act` and awaiting only the outer one
    // reproduces the real hazard instead: two taps landing in the same
    // frame, before React has re-rendered, which only the ref guard
    // survives. (React logs an "overlapping act()" warning here — expected
    // and harmless: it is two synchronous dispatches sharing one flush,
    // which is the point.)
    await act(async () => {
      fireEvent.press(shutter)
      fireEvent.press(shutter)
    })
    release({ uri: 'file:///tmp/shot.jpg' })
    await act(async () => {})
    expect(takePictureAsync).toHaveBeenCalledTimes(1)
  })

  it('says so and stays open when saving fails', async () => {
    // A camera screen that closes on failure loses the photo AND the message.
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    attachPhoto.mockRejectedValue(new Error('disk full'))
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    // Not just present — says something. `setError('')` would leave this
    // node in the tree with nothing in it: a coloured blank line, which
    // `toBeTruthy()` alone cannot tell apart from a real message.
    expect(screen.getByTestId('camera-error')).toHaveTextContent(
      'The photo could not be saved: disk full. Try the shutter again.',
    )
    expect(screen.getByTestId('camera-shutter')).toBeTruthy()
  })

  it('does not double the full stop when the cause already ends in one', async () => {
    // `attachPhoto`'s own message ends in a period, and glued to this
    // sentence uncorrected it read "...implements this seam.. Try the
    // shutter again." — the same defect `voice.tsx` carried.
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    attachPhoto.mockRejectedValue(new Error('Task 10 implements this seam.'))
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(screen.getByTestId('camera-error')).toHaveTextContent(
      'The photo could not be saved: Task 10 implements this seam. Try the shutter again.',
    )
  })

  it('strips trailing punctuation other than a full stop before adding its own', async () => {
    // `replace(/\.+$/, '')` only ever matched a run of full stops — a cause
    // ending in "?", "!" or an ellipsis went through unstripped and read
    // "Still loading…. Try the shutter again." — the same defect `voice.tsx`
    // carried.
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    attachPhoto.mockRejectedValue(new Error('Still loading…'))
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(screen.getByTestId('camera-error')).toHaveTextContent(
      'The photo could not be saved: Still loading. Try the shutter again.',
    )
  })

  it('does not attach and does not navigate back when saving fails', async () => {
    // The other half of "stays open when saving fails": a test that only
    // checked for the error text would still pass if the screen attached AND
    // showed an error AND left, which is not what "stays open" means.
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    attachPhoto.mockRejectedValue(new Error('disk full'))
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('returns to the record once the photo is attached', async () => {
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(routerBack).toHaveBeenCalled()
  })

  it('does not show an error after a successful capture', async () => {
    // Guards the positive path against a permanently-mounted error node: a
    // `camera-error` that is always in the tree, merely hidden by an empty
    // string, would satisfy `getByTestId` above without ever being absent.
    takePictureAsync.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(screen.queryByTestId('camera-error')).toBeNull()
  })

  it('shows the saving label while the write is in flight, and reverts once it settles', async () => {
    // Nothing else in this file presses the shutter and checks the label —
    // delete `saving` and the ternary that reads it, and every other test
    // still passes. Without this, there is no proof she gets any feedback
    // during the write.
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    let release: (v: unknown) => void = () => {}
    takePictureAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await renderScreen()
    expect(screen.getByTestId('camera-shutter')).toHaveTextContent('Capture')
    await fireEvent.press(screen.getByTestId('camera-shutter'))
    expect(screen.getByTestId('camera-shutter')).toHaveTextContent('Saving…')
    release({ uri: 'file:///tmp/shot.jpg' })
    await act(async () => {})
    expect(screen.getByTestId('camera-shutter')).toHaveTextContent('Capture')
  })

  it('renders something honest when opened without a record to attach to', async () => {
    // Latent until Task 10 wires up navigation to this screen, but
    // `useLocalSearchParams` yields `undefined` in practice regardless of
    // how the generic is spelled, and the seam validates nothing — an
    // `undefined` foreign key should never reach `attachPhoto`.
    mockRecordId = undefined
    setPermission({ granted: true, canAskAgain: false, status: 'granted' })
    await renderScreen()
    expect(screen.getByTestId('camera-no-record')).toHaveTextContent(/record/i)
    expect(screen.queryByTestId('camera-view')).toBeNull()
    expect(screen.queryByTestId('camera-shutter')).toBeNull()
  })
})
