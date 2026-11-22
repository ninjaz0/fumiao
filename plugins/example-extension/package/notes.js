export default {
  // Hooks may be async. `host` holds the functions this package declared:
  // a view can read, an action can also write.
  async view(input, host) {
    const { keys } = await host.data.list("notes/");
    const rows = [];
    for (const key of keys) {
      const note = await host.data.get(key);
      rows.push({
        id: key,
        title: note.text,
        status: note.savedAt,
        actions: [
          {
            action: "remove-note",
            label: "删除",
            payload: { key },
            confirm: { title: "删除备注", summary: note.text },
          },
        ],
      });
    }
    return {
      schema: 1,
      title: "工作区备注",
      blocks: [
        {
          type: "form",
          id: "add",
          presentation: "inline",
          fields: [
            { name: "text", label: "备注", type: "text", required: true },
          ],
          submit: { action: "add-note", label: "保存备注" },
        },
        { type: "list", empty: "当前工作区还没有备注。", rows },
      ],
    };
  },
  async action(id, payload, input, host) {
    if (id === "add-note") {
      const text = String(payload.text || "").trim();
      if (!text) throw Error("备注不能为空");
      const { keys } = await host.data.list("notes/");
      const next =
        keys.reduce((max, key) => Math.max(max, Number(key.slice(6))), 0) + 1;
      await host.data.put("notes/" + String(next).padStart(6, "0"), {
        text: text.slice(0, 200),
        savedAt: payload.savedAt || "",
      });
      return { notice: "备注已保存" };
    }
    if (id === "remove-note") {
      await host.data.delete(String(payload.key));
      return { notice: "备注已删除" };
    }
    throw Error("未知操作");
  },
};
