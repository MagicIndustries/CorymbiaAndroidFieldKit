import * as Application from 'expo-application'
import * as Device from 'expo-device'
import type { DeviceFacts, DeviceType } from '@corymbia/data'

/**
 * Reads this device's fixed characteristics (spec §7.5), so every record can say
 * which machine produced it. A coordinate from the 10-inch tablet is not
 * interchangeable with one from the phone.
 *
 * Every field is optional in the type because the platform genuinely declines to
 * report some of them on some devices, and an absent value is a better record
 * than an invented one.
 *
 * Verified against the installed SDKs (expo-device 57.0.1, expo-application
 * 57.0.2) before writing this — every field below exists as named, with two
 * things a future reader should know:
 *
 * - `Device.modelId` is typed `any` in expo-device's own declarations (not
 *   `string | null`), and its documentation says it is always `null` on
 *   Android and web — it is an iOS-only field. It is still read below, purely
 *   as a last-resort fallback identifier, but it will be `null` in every real
 *   record this (Android) app produces. Cast to `string | null` here rather
 *   than let `any` leak into `DeviceFacts`.
 * - `Application.getAndroidId()` and `Application.getInstallationTimeAsync()`
 *   are genuine, always-present functions in this SDK — not optional members
 *   that could be `undefined` — so they are called directly, without `?.()`.
 *   Off Android they throw `UnavailabilityError` rather than returning
 *   `undefined`; that is correct here; this app is Android-only, and
 *   `registerDevice` upserts on `installId`, so a silently degraded
 *   identifier would be worse than a startup failure — it would split one
 *   device's records across a new row on every launch.
 */
function toDeviceType(type: Device.DeviceType): DeviceType {
  switch (type) {
    case Device.DeviceType.PHONE:
      return 'phone'
    case Device.DeviceType.TABLET:
      return 'tablet'
    case Device.DeviceType.DESKTOP:
      return 'desktop'
    case Device.DeviceType.TV:
      return 'tv'
    default:
      return 'unknown'
  }
}

/**
 * A stable identifier for this installation.
 *
 * Android restricts hardware identifiers, and a reinstall legitimately produces a
 * new logical device — which is the right granularity, because a reinstall is
 * exactly when the data-collection setup could have changed underneath the
 * records. `getAndroidId()` is stable per app-signing-key per device; the
 * fallback keeps the app working if it is unavailable rather than failing to
 * register at all.
 */
async function readInstallId(): Promise<string> {
  const androidId = Application.getAndroidId()
  if (androidId) return androidId
  const installTime = await Application.getInstallationTimeAsync()
  const modelId = Device.modelId as string | null
  return `fallback-${installTime.getTime()}-${modelId ?? 'device'}`
}

export async function readDeviceFacts(): Promise<DeviceFacts> {
  const deviceType = await Device.getDeviceTypeAsync()
  const modelId = Device.modelId as string | null
  return {
    installId: await readInstallId(),
    // A short, human label. The device's own name is what she would call it.
    label: Device.deviceName ?? Device.modelName ?? 'this device',
    manufacturer: Device.manufacturer ?? null,
    brand: Device.brand ?? null,
    modelName: Device.modelName ?? null,
    modelId: modelId ?? null,
    deviceType: toDeviceType(deviceType),
    osName: Device.osName ?? null,
    osVersion: Device.osVersion ?? null,
    isPhysical: Device.isDevice,
    appVersion: Application.nativeApplicationVersion ?? null,
    appBuild: Application.nativeBuildVersion ?? null,
  }
}
