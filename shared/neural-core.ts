/** Tiny CPU inference, no native dependency or network. Weights are trained, not random at runtime. */
export type NeuralWeights = { inputs: number; hidden: number; outputs: number; w1: number[]; b1: number[]; w2: number[]; b2: number[] };
export function infer(model: NeuralWeights, input: readonly number[]): number[] {
  if (input.length !== model.inputs || input.some(x => !Number.isFinite(x))) throw new Error('Invalid neural observation');
  const hidden = model.b1.map((bias, h) => {
    let value = bias;
    for (let i = 0; i < model.inputs; i++) value += input[i] * model.w1[h * model.inputs + i];
    return Math.tanh(value);
  });
  const logits = model.b2.map((bias, o) => {
    let value = bias;
    for (let h = 0; h < model.hidden; h++) value += hidden[h] * model.w2[o * model.hidden + h];
    return value;
  });
  const max = Math.max(...logits), probabilities = logits.map(x => Math.exp(x - max)), sum = probabilities.reduce((a, b) => a + b, 0);
  return probabilities.map(x => x / sum);
}
export function textFeatures(text: string, dimensions = 256) {
  const features = Array<number>(dimensions).fill(0);
  const add = (token: string, weight: number) => {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
    features[(hash >>> 0) % dimensions] += weight;
  };
  for (const word of text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []) {
    add('w:' + word, .7);
    add('s:' + word.slice(0, 4), 1.4);
    const padded = '^' + word + '$';
    for (let i = 0; i < padded.length - 2; i++) add(padded.slice(i, i + 3), .55);
  }
  const length = Math.hypot(...features) || 1;
  return features.map(x => x / length);
}
export function best(probabilities: readonly number[]) { return probabilities.indexOf(Math.max(...probabilities)); }
