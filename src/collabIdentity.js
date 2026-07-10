// Generates a random, friendly identity for a collaboration session —
// "紅色頑皮海豹" / "Playful Red Seal" style — used purely for presence
// display (who's here, who's on which layer). Not tied to any Matrix/
// account identity.
import { locale } from './i18n.js'

const WORDS = {
  zh: {
    colors:  [
      { name: '紅色', hex: '#ef4444' },
      { name: '橙色', hex: '#f97316' },
      { name: '黃色', hex: '#eab308' },
      { name: '綠色', hex: '#22c55e' },
      { name: '藍色', hex: '#3b82f6' },
      { name: '紫色', hex: '#8b5cf6' },
      { name: '粉色', hex: '#ec4899' },
    ],
    moods:   ['頑皮', '開心', '冷靜', '好奇', '慵懶', '專注', '神秘'],
    animals: [
      { name: '海豹',   emoji: '🦭' },
      { name: '貓咪',   emoji: '🐱' },
      { name: '狐狸',   emoji: '🦊' },
      { name: '熊熊',   emoji: '🐻' },
      { name: '兔子',   emoji: '🐰' },
      { name: '貓頭鷹', emoji: '🦉' },
      { name: '水獺',   emoji: '🦦' },
    ],
    format: (color, mood, animal) => `${color}${mood}${animal}`,
  },
  en: {
    colors:  [
      { name: 'Red',    hex: '#ef4444' },
      { name: 'Orange', hex: '#f97316' },
      { name: 'Yellow', hex: '#eab308' },
      { name: 'Green',  hex: '#22c55e' },
      { name: 'Blue',   hex: '#3b82f6' },
      { name: 'Purple', hex: '#8b5cf6' },
      { name: 'Pink',   hex: '#ec4899' },
    ],
    moods:   ['Playful', 'Cheerful', 'Calm', 'Curious', 'Sleepy', 'Focused', 'Mysterious'],
    animals: [
      { name: 'Seal',  emoji: '🦭' },
      { name: 'Cat',   emoji: '🐱' },
      { name: 'Fox',   emoji: '🦊' },
      { name: 'Bear',  emoji: '🐻' },
      { name: 'Rabbit', emoji: '🐰' },
      { name: 'Owl',   emoji: '🦉' },
      { name: 'Otter', emoji: '🦦' },
    ],
    format: (color, mood, animal) => `${mood} ${color} ${animal}`,
  },
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateIdentity() {
  const words  = WORDS[locale.value] || WORDS.en
  const color  = pick(words.colors)
  const mood   = pick(words.moods)
  const animal = pick(words.animals)
  return {
    name:  words.format(color.name, mood, animal.name),
    emoji: animal.emoji,
    color: color.hex,
  }
}
