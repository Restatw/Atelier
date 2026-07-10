// Generates a random, friendly identity for a collaboration session —
// "紅色頑皮海豹" / "Playful Red Seal" style — used purely for presence
// display (who's here, who's on which layer). Not tied to any Matrix/
// account identity.
//
// The identity object carries locale-independent KEYS (colorKey/moodKey/
// animalKey) plus an `id` for equality checks, not a pre-formatted name.
// It's generated once and broadcast as-is to every peer, so if it baked in
// a display string, everyone would see it in whichever locale its owner
// happened to have at generation time — a Chinese-locale user and an
// English-locale user in the same room would get a mixed-language list,
// and switching locale wouldn't update anything already generated. Instead
// each viewer calls formatIdentityName() at render time with their OWN
// current locale, so names stay consistent with whoever's looking and
// update immediately on a locale switch.
const COLORS = [
  { key: 'red',    hex: '#ef4444', zh: '紅色', en: 'Red' },
  { key: 'orange', hex: '#f97316', zh: '橙色', en: 'Orange' },
  { key: 'yellow', hex: '#eab308', zh: '黃色', en: 'Yellow' },
  { key: 'green',  hex: '#22c55e', zh: '綠色', en: 'Green' },
  { key: 'blue',   hex: '#3b82f6', zh: '藍色', en: 'Blue' },
  { key: 'purple', hex: '#8b5cf6', zh: '紫色', en: 'Purple' },
  { key: 'pink',   hex: '#ec4899', zh: '粉色', en: 'Pink' },
]

const MOODS = [
  { key: 'playful',     zh: '頑皮', en: 'Playful' },
  { key: 'cheerful',    zh: '開心', en: 'Cheerful' },
  { key: 'calm',        zh: '冷靜', en: 'Calm' },
  { key: 'curious',     zh: '好奇', en: 'Curious' },
  { key: 'sleepy',      zh: '慵懶', en: 'Sleepy' },
  { key: 'focused',     zh: '專注', en: 'Focused' },
  { key: 'mysterious',  zh: '神秘', en: 'Mysterious' },
]

const ANIMALS = [
  { key: 'seal',   emoji: '🦭', zh: '海豹',   en: 'Seal' },
  { key: 'cat',    emoji: '🐱', zh: '貓咪',   en: 'Cat' },
  { key: 'fox',    emoji: '🦊', zh: '狐狸',   en: 'Fox' },
  { key: 'bear',   emoji: '🐻', zh: '熊熊',   en: 'Bear' },
  { key: 'rabbit', emoji: '🐰', zh: '兔子',   en: 'Rabbit' },
  { key: 'owl',    emoji: '🦉', zh: '貓頭鷹', en: 'Owl' },
  { key: 'otter',  emoji: '🦦', zh: '水獺',   en: 'Otter' },
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateIdentity() {
  const color  = pick(COLORS)
  const mood   = pick(MOODS)
  const animal = pick(ANIMALS)
  return {
    // Locale-independent, stable for the whole session — use this (not the
    // formatted name) for "is this me" / "same person" comparisons.
    id: `${color.key}-${mood.key}-${animal.key}-${Math.random().toString(36).slice(2, 7)}`,
    colorKey:  color.key,
    moodKey:   mood.key,
    animalKey: animal.key,
    emoji:     animal.emoji,
    color:     color.hex,
  }
}

// Renders an identity's display name in the given locale ('zh' or
// anything else falls back to 'en'). Call this at render time with the
// viewer's own current locale — never cache the result.
export function formatIdentityName(identity, loc) {
  if (!identity) return ''
  const color  = COLORS.find(c => c.key === identity.colorKey)
  const mood   = MOODS.find(m => m.key === identity.moodKey)
  const animal = ANIMALS.find(a => a.key === identity.animalKey)
  if (!color || !mood || !animal) return identity.name || ''
  return loc === 'zh'
    ? `${color.zh}${mood.zh}${animal.zh}`
    : `${mood.en} ${color.en} ${animal.en}`
}
