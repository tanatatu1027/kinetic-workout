import type { ReactNode } from 'react'

const Svg = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true">
    {children}
  </svg>
)

type P = { size?: number }

export const IconHome = (p: P) => <Svg {...p}><path d="M3 11 12 4l9 7M6 9.5V20h12V9.5" /><path d="M10 20v-6h4v6" /></Svg>
export const IconCalendar = (p: P) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" /><path d="M3.5 10h17M8 2.8V7M16 2.8V7" /><path d="M8 14h2M14 14h2M8 17h2" /></Svg>
export const IconChart = (p: P) => <Svg {...p}><path d="M4 4v16h16" /><path d="m7.5 15 4-4.5 3 2.5 5-6.5" /></Svg>
export const IconGear = (p: P) => <Svg {...p}><path d="M4 7h9M18 7h2M4 17h2M11 17h9" /><rect x="13" y="4.5" width="5" height="5" /><rect x="6" y="14.5" width="5" height="5" /></Svg>
export const IconBody = (p: P) => <Svg {...p}><circle cx="12" cy="4.5" r="2" /><path d="M7 9h10l-1.2 5H8.2zM9 14l-.8 7M15 14l.8 7M7 9 4.5 14M17 9l2.5 5" /></Svg>
export const IconCheck =(p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
export const IconBack = (p: P) => <Svg {...p}><path d="m14.5 5-7 7 7 7" /></Svg>
export const IconNext = (p: P) => <Svg {...p}><path d="m9.5 5 7 7-7 7" /></Svg>
export const IconDown = (p: P) => <Svg {...p}><path d="m5 9.5 7 7 7-7" /></Svg>
export const IconUp = (p: P) => <Svg {...p}><path d="m5 14.5 7-7 7 7" /></Svg>
export const IconClose = (p: P) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const IconMinus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>
export const IconBackspace = (p: P) => <Svg {...p}><path d="M8.5 5H21v14H8.5L3 12z" /><path d="m12 9.5 5 5M17 9.5l-5 5" /></Svg>
export const IconBolt = (p: P) => <Svg {...p}><path d="M13 3 5 13.5h6L10 21l8-11h-6z" /></Svg>
export const IconBodyComp = (p: P) => <Svg {...p}><rect x="4" y="4" width="16" height="16" /><path d="M8 9.5a4 3 0 0 1 8 0M12 9.5l2.2-2.2" /><path d="M8 15h8" /></Svg>
