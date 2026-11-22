export default (() => {
  const hostCallLimit = 32;
  const viewLegacyLimit = hostCallLimit - 2; // get collection, list keys
  const writeBaseCalls = 3; // get collection, list keys, put collection
  const valueByteLimit = 256 * 1024;
  const listRowLimit = 200;
  const fullNotice =
    "备注存储空间已满（最多 256 KB），请先删除部分备注后再保存。";
  const byteLength = (value) => {
    let bytes = 0;
    for (const char of JSON.stringify(value)) {
      const code = char.codePointAt(0);
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return bytes;
  };
  const compareNotes = (a, b) => {
    const aLegacy = a.id.startsWith("notes/");
    const bLegacy = b.id.startsWith("notes/");
    if (aLegacy !== bLegacy) return aLegacy ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  return {
    async view(input, host) {
      const saved = (await host.data.get("notes-v2")) || { next: 1, notes: [] };
      const { keys, more } = await host.data.list("notes/");
      const notes = [...saved.notes];
      for (const key of keys.slice(0, viewLegacyLimit))
        notes.push({ ...(await host.data.get(key)), id: key });
      const rows = notes.sort(compareNotes).map((note) => ({
        id: note.id,
        title: note.text.slice(0, 120),
        ...(note.text.length > 120 ? { detail: note.text } : {}),
        status: note.savedAt,
        actions: [
          {
            action: "remove-note",
            label: "删除",
            payload: { key: note.id },
            confirm: { title: "删除备注", summary: note.text },
          },
        ],
      }));
      const lists = [];
      for (let i = 0; i < rows.length || i === 0; i += listRowLimit)
        lists.push({
          type: "list",
          empty: "当前工作区还没有备注。",
          rows: rows.slice(i, i + listRowLimit),
        });
      return {
        schema: 1,
        title: "工作区备注",
        ...(more || keys.length > viewLegacyLimit
          ? { description: "部分旧备注将在下次保存或删除备注时显示。" }
          : {}),
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
          ...lists,
        ],
      };
    },
    async action(id, payload, input, host) {
      if (!["add-note", "remove-note"].includes(id)) throw Error("未知操作");
      const saved = (await host.data.get("notes-v2")) || { next: 1, notes: [] };
      let removedLegacy;
      if (id === "add-note") {
        const text = String(payload.text || "").trim();
        if (!text) throw Error("备注不能为空");
        saved.notes.push({
          id: "note/" + String(saved.next++).padStart(6, "0"),
          text: text.slice(0, 200),
          savedAt: payload.savedAt || "",
        });
        if (byteLength(saved) > valueByteLimit) return { notice: fullNotice };
      } else {
        const key = String(payload.key);
        if (saved.notes.some((note) => note.id === key))
          saved.notes = saved.notes.filter((note) => note.id !== key);
        else if (key.startsWith("notes/")) removedLegacy = key;
      }
      const { keys } = await host.data.list("notes/");
      const migrationLimit = Math.floor(
        (hostCallLimit - writeBaseCalls - (removedLegacy ? 1 : 0)) / 2,
      );
      const migrated = [];
      let savedBytes = byteLength(saved);
      for (const key of keys
        .filter((key) => key !== removedLegacy)
        .slice(0, migrationLimit)) {
        const note = await host.data.get(key);
        const entry = { ...note, id: key };
        const entryBytes = byteLength(entry) + (saved.notes.length ? 1 : 0);
        if (savedBytes + entryBytes > valueByteLimit) break;
        saved.notes.push(entry);
        savedBytes += entryBytes;
        migrated.push(key);
      }
      await host.data.put("notes-v2", saved);
      for (const key of migrated) await host.data.delete(key);
      if (removedLegacy) await host.data.delete(removedLegacy);
      return { notice: id === "add-note" ? "备注已保存" : "备注已删除" };
    },
  };
})();
