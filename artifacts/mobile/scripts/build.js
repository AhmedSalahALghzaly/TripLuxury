const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function stripProtocol(domain) {
  let urlString = domain.trim();
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }
  return new URL(urlString).host;
}

function getDeploymentDomain() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    return stripProtocol(process.env.REPLIT_INTERNAL_APP_DOMAIN);
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return stripProtocol(process.env.REPLIT_DEV_DOMAIN);
  }
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return stripProtocol(process.env.EXPO_PUBLIC_DOMAIN);
  }
  console.error(
    "ERROR: No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN",
  );
  process.exit(1);
}

function main() {
  console.log("Building Expo web app for browser deployment...");

  const domain = getDeploymentDomain();
  console.log(`Target domain: ${domain}`);

  const env = {
    ...process.env,
    EXPO_PUBLIC_DOMAIN: domain,
    NODE_ENV: "production",
  };

  const result = spawnSync(
    "pnpm",
    ["exec", "expo", "export", "--platform", "web", "--output-dir", "dist", "--clear"],
    {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    console.error("Web export failed with exit code:", result.status);
    process.exit(result.status || 1);
  }

  console.log("Web build complete. Output: dist/");
}

main();
