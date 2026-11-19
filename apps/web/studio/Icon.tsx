// SVG path data from the pinned studio bundle.
const paths = {
  gpu: "M6 6h12v12H6z M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4",
  drive: "M4 5h16l2 10v4H2v-4z M3 14h18 M16 17h2",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19",
  moon: "M20 14.4A8.4 8.4 0 019.6 4a8.5 8.5 0 1010.4 10.4z",
  account: "M20 21v-2a7 7 0 00-14 0v2M12 3a4 4 0 110 8 4 4 0 010-8z",
  chat: "M21 11.5a8 8 0 01-8 8H5l-3 3v-11a8 8 0 018-8h3a8 8 0 018 8zM7 9h9M7 13h6",
  voice:
    "M9 5a3 3 0 016 0v7a3 3 0 01-6 0V5zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8",
  link: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-2 2 M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l2-2",
  // The pinned invite button renders an empty glyph through an undefined path.
  copy: "undefined",
  switch: "M5 7h14l-3-3M19 17H5l3 3",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  create: "M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z",
  library: "M3 7h7l2 2h9v10H3z M3 7V5h7l2 2",
  canvas: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  team: "M3 20v-2a5 5 0 0110 0v2 M17 13a4 4 0 014 4v3 M12 7a4 4 0 11-8 0 4 4 0 018 0z M16 4a3 3 0 010 6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M12 19V5 M6 11l6-6 6 6",
  film: "M3 5h18v14H3z M7 5v14m10-14v14 M3 9h4m-4 6h4m10-6h4m-4 6h4",
  sliders: "M4 7h7m5 0h4M4 17h2m5 0h9 M11 4v6m-4 4v6",
  logout: "M9 3H4v18h5 M9 12h12m-5-5 5 5-5 5",
  picture: "M3 4h18v16H3z M4 17l5-5 4 4 3-3 4 4",
  queue: "M4 6h16M4 12h12M4 18h8",
  sidebar: "M4 5h16v14H4zM14 5v14",
  model: "m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  clock: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  download: "M12 3v12m-5-5 5 5 5-5M4 20h16",
  edit: "m15 4 5 5-11 11H4v-5zM13 6l5 5",
  check: "m5 12 4 4L19 6",
  at: "M16 8v6a2 2 0 004 0v-2a8 8 0 10-4 7M16 12a4 4 0 11-8 0 4 4 0 018 0",
  frame: "M3 7h18v10H3z",
  play: "m9 5 10 7-10 7z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  close: "m6 6 12 12M18 6 6 18",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m7 10 5 4 5-4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  repeat: "M20 7h-6l3-4M4 17h6l-3 4M20 7a9 9 0 00-15 0M4 17a9 9 0 0015 0",
  pause: "M8 5v14M16 5v14",
  volume: "M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 010 8m3-11a10 10 0 010 14",
  muted: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6",
  fullscreen: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  settings:
    "M10 2h4l.8 3.1 1.7 1 3.1-.9 2 3.5-2.4 2.1v2.4l2.4 2.1-2 3.5-3.1-.9-1.7 1L14 22h-4l-.8-3.1-1.7-1-3.1.9-2-3.5 2.4-2.1v-2.4L2.4 8.7l2-3.5 3.1.9 1.7-1zM15.5 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z",
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2.5 4.5 3.5 3 3.5-3" />
    </svg>
  );
}
