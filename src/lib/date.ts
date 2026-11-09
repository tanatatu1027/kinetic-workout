const pad = (n: number) => String(n).padStart(2, '0')

export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayKey = () => toKey(new Date())

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** 週の始まりは日曜 */
export const startOfWeek = (d: Date) => addDays(d, -d.getDay())

export const WEEK_JP = ['日', '月', '火', '水', '木', '金', '土']

export const fmtLong = (k: string) => {
  const d = fromKey(k)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEK_JP[d.getDay()]}）`
}

export const fmtShort = (k: string) => {
  const d = fromKey(k)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK_JP[d.getDay()]}）`
}

export const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const fmtMinutes = (ms: number) => {
  const m = Math.round(ms / 60000)
  if (m < 1) return '1分未満'
  if (m < 60) return `${m}分`
  return `${Math.floor(m / 60)}時間${pad(m % 60)}分`
}
