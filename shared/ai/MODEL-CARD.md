# Bundled Mimic MLPs, version 1

These are small, genuine trained feed-forward neural networks. They are **not** a large language model, online learning, reinforcement learning, human gameplay imitation, a mind-reading system or a guarantee of human-like play. A separate optional server-only LLM adapter supplies generative dialogue.

## Provenance / reproducibility

- Original synthetic examples: `scripts/mimic-demonstrations.mjs`. No downloaded weights, private data, player logs or player conversations were used.
- Training: dependency-free JavaScript, deterministic PRNG seed **93147**, supervised cross-entropy and SGD, tanh hidden layer, softmax outputs. Weights rounded to six decimals and checked into `weights.ts` (about 125 KB of source).
- Regenerate from the repository root with **`npm run train:ai`** on Node 22.18+ (Node 24.22.3 recommended). This is optional: ordinary builds require no training, network access, Python, GPU or extra neural runtime.
- The training script validates before replacing the model file. Runtime inference only multiplies trained weights; it does not call the synthetic teacher or generate random weights.

## Behaviour policy

**12 → 28 → 5** MLP. Inputs, in order:

1. Distance to the current target, divided by 24 m and clamped to 1.
2. Line-of-sight flag.
3. Target moving flag.
4. Target sprinting flag.
5. Collected fuses / 3.
6. Number of nearby living humans / 4.
7. Cooperation/trust proxy / 40 (game telemetry, not real beliefs).
8. Disguise age / 60 s, clamped to 1.
9. Recent public chat flag.
10. Recent chat classified as suspicion.
11. Recent chat classified as a request to wait.
12. Seeded variety value.

Outputs: **follow, lead, wait, explore, lure**. Trained on 3250 balanced synthetic observations labelled by a rule-based demonstration teacher (650 per action); 110 epochs, initial learning rate .025, linear decay. Reported accuracy **94.87%** on 3000 held-out synthetic observations from that teacher. A second seed is checked by unit tests. This only measures reproduction of those synthetic demonstrations — **not player deception or realism**.

Movement execution, pathfinding, collision, minimum disguise interval, reveal, hunting/search, damage, objectives and brief pauses remain deterministic game systems. The policy controls high-level disguised intentions, not arbitrary coordinates or every joint of an animated model. A configured LLM can temporarily override those high-level intentions with a validated plan; the MLP continues to be the unavailable-model fallback.

## Dialogue intent classifier

**256 → 48 → 8** MLP. Normalised hashed Cyrillic/Latin word, four-character stem and character-trigram features. Eight outputs: greeting, location, wait, help, objective, suspicion, light, other. Confidence below .58 is mapped to `other`.

137 authored base phrases; 1233 training examples after prefix/suffix augmentation, 100 epochs, initial learning rate .04. **90.51%** on 274 held-out **perturbations of those same known phrases**, not unseen semantic topics. This small classifier can misinterpret unfamiliar phrasing, multiple intents, sarcasm, spelling errors or other languages. No general language-understanding benchmark is claimed.

The classifier selects **authored phrase banks with simple game context**, including fuse count and power state. It does **not** generate new free-form language. Chat context is transient. Weights are not updated by players during play.

## Operational boundaries

Both networks run on CPU with no native dependency in the offline browser graph and authoritative server. All optional provider configuration/authentication stays in `server/mimic-llm.ts`, never in these weights or the browser bundle. Public room views expose only the coarse AI mode/availability, not plans, neural features or hidden trust values. See [`docs/MIMIC-AI.md`](../../docs/MIMIC-AI.md) for privacy, limitations, configuration and tests.
