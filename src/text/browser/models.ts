export const DEFAULT_MODEL = "qwen2.5-0.5b"

export const BROWSER_MODELS = [
  {
    id: DEFAULT_MODEL,
    name: "Qwen2.5 0.5B Instruct · Q4_K_M",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    bytes: 491400032,
    sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
    license: "Apache-2.0",
  },
  {
    id: "smollm2-360m",
    name: "SmolLM2 360M Instruct · Q4_K_M",
    url: "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/7be6f65f1db715fe5dc5a4634c0d459b4eed42ec/SmolLM2-360M-Instruct-Q4_K_M.gguf",
    bytes: 270590880,
    sha256: "2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2",
    license: "Apache-2.0",
  },
] as const
