export default {
  run({ script, pace = "自然" }) {
    const characters = [...script].filter((ch) =>
      /[\p{L}\p{N}]/u.test(ch),
    ).length;
    const perMinute = { 舒缓: 180, 自然: 240, 紧凑: 300 }[pace];
    return JSON.stringify({
      characters,
      charactersPerMinute: perMinute,
      estimatedSeconds: Math.ceil((characters * 60) / perMinute),
    });
  },
};
