# WorkDSH Web and plugins v0.1.0-alpha.17

This release lets users start local models from first-run setup, uses Desktop's bundled speech recognition model for voice input, and shows the white-label mark on the chat start page. It still uses DeepSeek Harness 0.2.0-rc.1, a release candidate.

- **Bundle (0.1.0-alpha.56):**
  - **First-run choice:** setup now asks whether to start the local model server (llama.cpp) or to enter a DeepSeek API key. Choosing local models starts the server at once and makes the first local model the default for new sessions. While the models folder is empty, setup shows the folder and how to add GGUF files.
  - **Models page:** a card for the local model server shows its state, its models and the models folder. It can turn the server on or off and make a local model the default.
  - **Server start:** `workdsh-bundle/local-models` starts the bundled `llama-server` itself, through DSH's subprocess service, so the server stops with the Host. The user's choice is kept across launches. Until the user chooses, the server starts by itself once the models folder holds a GGUF model. A Web deployment can still point `WORKDSH_LLAMA_BASE_URL` and `WORKDSH_LLAMA_API_KEY` at its own router.
  - **White-label mark:** the chat start page shows the product mark instead of DeepSeek Harness's whale, as the sidebar already did.
  - **Voice input:** when the host names bundled SenseVoice weights in `WORKDSH_SENSEVOICE_MODEL_DIR` and `WORKDSH_SENSEVOICE_VAD`, as Desktop does with its INT4 weights, DSH's local speech-to-text uses them instead of downloading a model.

The release contains 12 WorkDSH packages, the install script, a manifest, and SHA-256 checksums. SkillHub and dsh-market are third-party services or plugins, and their catalog entries are neither bundled nor approved by WorkDSH. Check each item's license, dependencies, and DSH compatibility before you install it.

This is an Alpha release built on a DSH release candidate. Back up local profiles before you upgrade. The desktop installers are published separately as `desktop-v*` releases.
