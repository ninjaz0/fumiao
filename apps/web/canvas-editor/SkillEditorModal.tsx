import { SkillEditorCard } from "../studio/SkillEditorCard";

export function SkillEditorModal({ workspace }: { workspace: number }) {
  return <SkillEditorCard workspace={workspace} />;
}
