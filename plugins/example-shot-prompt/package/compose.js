export default {
  run({ inputs, values }) {
    return { prompt: values.framing + "：" + inputs.script };
  },
};
