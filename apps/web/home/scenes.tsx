import type { SVGProps } from "react";

function Gradient({
  id,
  vertical = false,
  name,
}: {
  id: string;
  vertical?: boolean;
  name: string;
}) {
  return (
    <linearGradient
      id={id}
      {...(vertical ? { x1: "0", y1: "0", x2: "0", y2: "1" } : {})}
    >
      <stop offset="0" className={name + "-a"} />
      <stop offset=".5" className={name + "-b"} />
      <stop offset="1" className={name + "-c"} />
    </linearGradient>
  );
}

export function Scene({
  index,
  ...props
}: SVGProps<SVGSVGElement> & { index: number; "data-scene": string }) {
  const kind = props["data-scene"] || "dawn";
  const id = "s" + index;
  const shift = kind === "noon" ? 18 : kind === "dusk" ? -14 : 0;
  return (
    <svg {...props} className={props.className + " scene-" + kind}>
      <defs>
        <Gradient id={id + "sky"} name="sky" vertical />
        <Gradient id={id + "thread"} name="thread" />
      </defs>
      <rect width="320" height="200" fill={`url(#${id}sky)`} />
      <circle
        cx={kind === "dusk" ? "232" : "88"}
        cy={kind === "noon" ? "52" : "86"}
        r="26"
        className="sun"
      />
      <rect y="128" width="320" height="72" className="sea" />
      <g stroke={`url(#${id}thread)`} fill="none" strokeWidth="1.1">
        {Array.from({ length: 22 }, (_, i) => (
          <path
            key={i}
            d={`M-30 ${150 + shift / 2 + i * 1.6} C 60 ${110 + i * 2.2}, 110 ${190 - i * 1.4}, 170 ${120 + shift - i * 0.9} S 280 ${70 + i * 1.8}, 360 ${96 + i * 1.5}`}
          />
        ))}
      </g>
    </svg>
  );
}

export function Ribbon(
  props: SVGProps<SVGSVGElement> & { "data-ribbon": string },
) {
  return (
    <svg {...props}>
      <defs>
        <Gradient id="closing-thread" name="thread" />
      </defs>
      <g stroke="url(#closing-thread)" fill="none" strokeWidth="1.2">
        {Array.from({ length: 40 }, (_, i) => (
          <path
            key={i}
            d={`M-60 ${120 + i * 1.9} C 70 ${60 + i * 2.6}, 140 ${200 - i * 1.8}, 250 ${110 - i * 1.1} S 400 ${30 + i * 2}, 540 ${46 + i * 2.1}`}
          />
        ))}
      </g>
    </svg>
  );
}
