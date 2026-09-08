import { mediaFileName } from '../naming'

describe('mediaFileName', () => {
  it('names a photo by the media id and a jpeg extension', () => {
    expect(mediaFileName('med_abc123', 'photo')).toBe('med_abc123.jpg')
  })

  it('names a voice note with the m4a extension expo-audio actually writes', () => {
    // RecordingPresets.HIGH_QUALITY records .m4a on Android. A stored name
    // claiming .mp3 or .wav would be a lie the export manifest then repeats.
    expect(mediaFileName('med_abc123', 'voice')).toBe('med_abc123.m4a')
  })

  it('depends on nothing that can later change', () => {
    // The whole reason this takes a media id and not a record plus an index
    // (spec §12.1). The name must survive reordering, removal of an earlier
    // attachment, refiling the record, and retitling it.
    expect(mediaFileName('med_abc123', 'photo')).toBe(mediaFileName('med_abc123', 'photo'))
  })

  // The id reaches this function from `newId`, so in practice it is always
  // safe. The guard is here because the RESULT IS A FILESYSTEM PATH: an id
  // carrying a slash or a `..` would write outside the media directory, and
  // "the only caller is safe today" is not a property the type system holds
  // on to. Cheap to enforce, permanently.
  it.each([
    ['a path separator', 'med/../../etc'],
    ['a parent traversal', '..'],
    ['a dot segment', 'med.abc'],
    ['an empty id', ''],
  ])('refuses %s', (_label, mediaId) => {
    expect(() => mediaFileName(mediaId, 'photo')).toThrow(/media id/i)
  })
})
