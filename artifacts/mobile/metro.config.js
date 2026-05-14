const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root so Metro can resolve workspace packages
config.watchFolders = [workspaceRoot];

// Allow Metro to resolve modules from both the project root and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Block unnecessary paths to speed up Metro
const defaultBlockList = config.resolver.blockList || [];
const blockListArray = Array.isArray(defaultBlockList)
  ? defaultBlockList
  : [defaultBlockList];

config.resolver.blockList = [
  ...blockListArray,
  /\/\.local\/.*/,
  /\/\.git\/.*/,
  /\/artifacts\/api-server\/.*/,
  /\/artifacts\/mockup-sandbox\/.*/,
  /\/lib\/api-server\/.*/,
  // pnpm install temp folders (e.g. @posthog/types_tmp_<pid>) that the
  // Metro watcher tries to FS-watch and crashes on when they're deleted.
  /node_modules\/.*_tmp_.*/,
];

module.exports = config;
