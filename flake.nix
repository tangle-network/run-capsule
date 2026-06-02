{
  description = "run-capsule — trace → shareable video. Dev shell with node, pnpm, ffmpeg, and Chromium wired for Playwright.";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.nodejs_22.pkgs.pnpm
            pkgs.ffmpeg
            pkgs.playwright-driver.browsers
          ];

          # Point Playwright at the Nix-provided browsers instead of downloading
          # its own; skip the host-requirement validation Nix can't satisfy.
          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            echo "run-capsule dev shell — node $(node -v), ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3), Chromium via PLAYWRIGHT_BROWSERS_PATH"
          '';
        };
      });
}
