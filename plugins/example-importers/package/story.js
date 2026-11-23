export default {
  async plan({ source }, host) {
    let story;
    if (source.startsWith("https://")) {
      const response = await host.http.fetch(source, { method: "GET" });
      if (!response.ok) throw Error("无法读取清单");
      story = response.json;
    } else story = JSON.parse(source);
    const { title, shots } = story;
    if (!Array.isArray(shots) || !shots.length || shots.length > 64)
      throw Error("清单需要 1–64 个镜头");
    const nodes = [],
      edges = [],
      sequence = [];
    shots.forEach((line, i) => {
      if (typeof line !== "string") throw Error("镜头文案必须为文本");
      const script = "script-" + i,
        shot = "shot-" + i;
      nodes.push(
        { id: script, type: "text", x: 0, y: 300 * i, text: line },
        { id: shot, type: "video", x: 400, y: 300 * i, prompt: line },
      );
      edges.push({ id: "edge-" + i, source: script, target: shot });
      sequence.push(shot);
    });
    return {
      target: "canvas",
      canvas: { title, nodes, edges, shots: sequence },
    };
  },
};
