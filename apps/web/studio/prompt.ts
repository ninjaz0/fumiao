import {
  mediaURL,
  referenceIndex,
  referenceLabel,
  referenceType,
  type StudioState,
} from "./state";
export { reindexPrompt } from "./state";

export function readPrompt(
  editor: HTMLElement,
  state: StudioState,
  refs: string[],
  plain = false,
) {
  let text = "";
  function read(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent || "").replace(/\r\n?/g, "\n");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const id = node.dataset.refid;
    if (id) {
      if (!plain && refs.includes(id))
        text += `<${referenceType(state, id)} ${referenceIndex(state, id, refs)}>`;
      return;
    }
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && text && !text.endsWith("\n")) text += "\n";
    const start = text.length;
    for (const child of node.childNodes) read(child);
    if (block && (text.length === start || !text.endsWith("\n")))
      text += "\n";
  }
  for (const child of editor.childNodes) read(child);
  const output = text.replace(/\n+$/, "");
  if (plain) return output;
  const names = { 图片: "Picture", 视频: "Video", 音频: "Audio" } as const;
  const types = refs.map((id) => referenceType(state, id));
  return output.replace(/@(图片|视频|音频)(\d+)/g, (match, name: keyof typeof names, digits) => {
    const index = Number(digits);
    const type = names[name];
    const count = types.filter((value) => value === type).length;
    return index >= 1 && index <= count && String(index) === digits
      ? `<${type} ${index}>`
      : match;
  });
}

export function createReferenceToken(
  state: StudioState,
  refs: string[],
  id: string,
) {
  const token = document.createElement("span");
  token.className = "reference-token";
  token.contentEditable = "false";
  token.dataset.refid = id;
  const type = referenceType(state, id);
  if (type === "Picture") {
    const image = document.createElement("img");
    image.src = mediaURL(id);
    image.alt = "";
    token.append(image);
  } else if (type === "Video") {
    const video = document.createElement("video");
    video.src = mediaURL(id) + "#t=0.1";
    video.preload = "metadata";
    video.setAttribute("muted", "");
    video.playsInline = true;
    token.append(video);
  } else {
    const thumb = document.createElement("span");
    thumb.className = "h3-audio-thumb";
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute(
      "d",
      "M9 5a3 3 0 016 0v7a3 3 0 01-6 0V5zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8",
    );
    svg.append(path);
    thumb.append(svg);
    token.append(thumb);
  }
  const label = document.createElement("span");
  label.textContent = referenceLabel(state, id, refs);
  token.append(label);
  return token;
}

export function paintPrompt(
  editor: HTMLElement,
  state: StudioState,
  refs: string[],
  prompt: string,
  plain: boolean,
) {
  const nodes = document.createDocumentFragment();
  function appendText(text: string) {
    text.split("\n").forEach((line, index) => {
      if (index) nodes.append(document.createElement("br"));
      if (line) nodes.append(line);
    });
  }
  let cursor = 0;
  for (const match of prompt.matchAll(/<(Picture|Video|Audio) (\d+)>/g)) {
    appendText(prompt.slice(cursor, match.index));
    const id = refs.filter((ref) => referenceType(state, ref) === match[1])[
      Number(match[2]) - 1
    ];
    if (id && !plain) nodes.append(createReferenceToken(state, refs, id));
    else appendText(match[0]);
    cursor = match.index + match[0].length;
  }
  appendText(prompt.slice(cursor));
  nodes.normalize();
  editor.replaceChildren(nodes);
}

export function rememberSelection(editor: HTMLElement, previous: Range | null) {
  const selection = getSelection();
  if (
    !selection?.rangeCount ||
    !editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  )
    return previous;
  return selection.getRangeAt(0).cloneRange();
}
export function appendAtCaret(
  editor: HTMLElement,
  node: Node,
  previous: Range | null,
) {
  editor.focus();
  let range = previous?.cloneRange();
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}
