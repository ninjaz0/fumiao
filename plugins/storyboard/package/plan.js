export default {
  plan({ shots }) {
    return shots.map((shot, index) => ({
      index,
      narration: !!shot.voice,
      subtitles: !!shot.text,
    }));
  },
};
