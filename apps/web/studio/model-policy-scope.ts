import type { Space, StudioState } from "./state";

export function countTeamPolicyDiffs(
  modelGroups: StudioState["model_groups"],
  globalPolicy: StudioState["model_policy"] | undefined,
  teamPolicy: StudioState["model_policy"] | undefined,
): number {
  if (!globalPolicy || !teamPolicy) return 0;
  let diffs = 0;
  for (const group of Object.values(modelGroups || {})) {
    const globalOpen = group.models.some((model) => globalPolicy.enabled[model]);
    const teamOpen = group.models.some((model) => teamPolicy.enabled[model]);
    if (globalOpen !== teamOpen) ++diffs;
  }
  return diffs;
}

export function filterTeamScopes(
  teams: readonly Space[],
  query: string,
  onlyCustom: boolean,
  diffCount: (teamId: number) => number,
): Space[] {
  const needle = query.trim().toLowerCase();
  return teams.filter((team) => {
    if (onlyCustom && diffCount(team.id) === 0) return false;
    return !needle || team.name.toLowerCase().includes(needle);
  });
}
