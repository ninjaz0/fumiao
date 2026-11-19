export default (values, { scope, from }) => {
  if (from === "1.0.0") {
    if (scope === "global" && typeof values.useModelIds === "boolean") {
      return { labelMode: values.useModelIds ? "id" : "name" };
    }
    if (scope === "workspace" && typeof values.includeDisabled === "boolean") {
      return { showDisabled: values.includeDisabled };
    }
  }
  return values;
};
