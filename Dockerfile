# run-capsule — everything needed to record agent-run videos, bundled.
#
# Based on the official Playwright image (Chromium + all system libs
# preinstalled); we add ffmpeg for the MP4 transcode. Keep the tag in sync with
# the `playwright` version this package resolves (currently 1.60.x).
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# ffmpeg → MP4 transcode (without it, output stays .webm).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Browsers already live in the image (/ms-playwright) — don't re-download them.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

# Default output dir; mount a host volume here to collect clips.
VOLUME ["/out"]
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
