import AjvModule from "ajv";
const Ajv = AjvModule.default || AjvModule;
export const validator = new Ajv({
  allErrors: true,
  useDefaults: true,
  strict: false,
});
export const matcher = new Ajv({ allErrors: true, strict: false });
