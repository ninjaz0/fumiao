export default {
  run({ inputs, values }) {
    return { result: values.prefix + inputs.text.trim() };
  },
};
