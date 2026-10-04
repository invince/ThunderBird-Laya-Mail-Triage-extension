// web-ext configuration (used by `web-ext lint`, `run`, `sign`).
export default {
  sourceDir: ".",
  artifactsDir: "dist",
  ignoreFiles: [
    "dist/**",
    "node_modules/**",
    "build.sh",
    "package.json",
    "package-lock.json",
    "*.md",
    "*.xpi",
    ".git/**"
  ]
};
