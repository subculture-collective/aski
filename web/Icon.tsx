// One small stroke icon set (18px box, currentColor) so controls share a single visual weight.
const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  chevron: 'M6 9l6 6 6-6',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  pin: 'M9 4h6l-1 6 4 4H6l4-4zM12 14v6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
} as const;
export function Icon({ name, filled = false }: { name: keyof typeof PATHS; filled?: boolean }) {
  return <svg className="icon-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d={PATHS[name]} />
  </svg>;
}
