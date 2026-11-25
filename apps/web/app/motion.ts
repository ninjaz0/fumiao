export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function reducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches;
}

export function scrollMotion(): ScrollBehavior {
  return reducedMotion() ? "instant" : "smooth";
}

export function cameraMotion() {
  return {
    duration: reducedMotion() ? 0 : 180,
    interpolate: "linear" as const,
  };
}
