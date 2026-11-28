export type TurnBill = {
  turn: string;
  message: number;
  user_message: number;
  superseded: boolean;
  kind: "fixed" | "token";
  state: string;
  held: string | null;
  charged: string | null;
  waived?: string;
  usage?: string | null;
  lines?: {
    key: "input" | "cacheRead" | "cacheWrite" | "output";
    tokens: string;
    rate: string;
    inherited_from: string | null;
    subtotal: string;
  }[];
  calls?: { reason: string | null }[];
};
const labels = {
  input: "普通输入",
  cacheRead: "缓存命中",
  cacheWrite: "缓存写入",
  output: "输出",
};
export function ChatBill({ bill }: { bill: TurnBill }) {
  return (
    <details className="fm-chat-bill">
      <summary>
        {bill.superseded ? "重试前的回复 · " : ""}
        {bill.charged === null ? "实扣未记录" : `实扣 ${bill.charged} 积分`}
      </summary>
      <p>
        {bill.kind === "fixed" ? "固定价" : "按 Token 结算"} · 预留{" "}
        {bill.held ?? "未记录"}
        {bill.held !== null ? " 积分" : ""}
      </p>
      {bill.lines?.map((line) => (
        <p key={line.key}>
          {labels[line.key]} {line.tokens} Token × {line.rate} 积分 / 百万 Token
          {line.inherited_from ? "（随普通输入价）" : ""} = {line.subtotal} 积分
        </p>
      ))}
      {bill.kind === "fixed" && <p>用量 {bill.usage ?? "未记录"}</p>}
      {bill.calls?.map(
        (call, i) =>
          call.reason && (
            <p key={i}>
              第 {i + 1} 次推理 · {call.reason}
            </p>
          ),
      )}
      {bill.state !== "complete" && <p>回复未完成，已释放预留</p>}
      {bill.waived && bill.waived !== "0" && <p>减免 {bill.waived} 积分</p>}
    </details>
  );
}
