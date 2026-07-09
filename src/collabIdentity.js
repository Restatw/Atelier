// Generates a random, friendly identity for a collaboration session —
// "紅色頑皮海豹" style — used purely for presence display (who's here,
// who's on which layer). Not tied to any Matrix/account identity.
const COLORS = [
  { name: '紅色', hex: '#ef4444' },
  { name: '橙色', hex: '#f97316' },
  { name: '黃色', hex: '#eab308' },
  { name: '綠色', hex: '#22c55e' },
  { name: '藍色', hex: '#3b82f6' },
  { name: '紫色', hex: '#8b5cf6' },
  { name: '粉色', hex: '#ec4899' },
]

const MOODS = ['頑皮', '開心', '冷靜', '好奇', '慵懶', '專注', '神秘']

const ANIMALS = [
  { name: '海豹',   emoji: '🦭' },
  { name: '貓咪',   emoji: '🐱' },
  { name: '狐狸',   emoji: '🦊' },
  { name: '熊熊',   emoji: '🐻' },
  { name: '兔子',   emoji: '🐰' },
  { name: '貓頭鷹', emoji: '🦉' },
  { name: '水獺',   emoji: '🦦' },
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateIdentity() {
  const color  = pick(COLORS)
  const mood   = pick(MOODS)
  const animal = pick(ANIMALS)
  return {
    name:  `${color.name}${mood}${animal.name}`,
    emoji: animal.emoji,
    color: color.hex,
  }
}
