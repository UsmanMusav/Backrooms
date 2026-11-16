# Explorer model / animation sources

The model and animation source packs are **CC0 1.0** by **Quaternius** (https://quaternius.com).

- Continuous, rigged male body: Universal Base Characters, Standard/free edition. Source mirror: https://github.com/NafisRayan/Animate-Rigged-Humanoid-No-Blender/tree/main/Universal%20Base%20Characters%5BStandard%5D . Source tree used: `5821923af517ac5fdc82505faa92a0d575fc1b1a`.
- Animations: Universal Animation Library, Standard/free edition. Source mirror: https://github.com/J-Ponzo/gltf-universal-animation-library . Source tree used: `e24c23cf2a1323488a3faa226ea7ea21f644b73e`.
- Original Standard license notice is preserved in `Quaternius-Standard-License.txt`; complete CC0 dedication in `CC0-1.0.txt`.

BACKROOMS adaptations: clothed explorer albedo/roughness and woven-fabric normal textures, padded/smoothed workwear mesh, UE-to-Universal skeleton retargeting, idle/torch/walk/run/interact/reveal/attack/death clips, in-place animation, and first-person arm extraction. Humans and the disguised Mimic use exactly the same GLB and animation controller.

`explorer.glb` is a real skinned character with a continuous body, 65 bones and eight animation clips, not an assembly of primitive limbs. It has no external URLs and is bundled into the offline EXE. `scripts/fetch-character-sources.mjs`, `scripts/prepare-character.mjs` and `scripts/paint-explorer.py` document the optional offline art pipeline; source downloads are kept in the ignored `.cache/character-source` directory. Normal game builds use the checked-in, prepared assets and do not need Python or these art sources.
