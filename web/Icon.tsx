// One small stroke icon set (18px box, currentColor) so controls share a single visual weight.
const PATHS = {
  chevron: 'M6 9l6 6 6-6',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  pin: 'M9 4h6l-1 6 4 4H6l4-4zM12 14v6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
} as const;
export function Icon({ name, filled = false }: { name: keyof typeof PATHS; filled?: boolean }) {
  return <svg className="icon-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d={PATHS[name]} />
  </svg>;
}
