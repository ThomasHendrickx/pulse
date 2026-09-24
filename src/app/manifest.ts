import type { MetadataRoute } from "next";
import {
  SHARE_TARGET_FILE_FIELD,
  SHARE_TARGET_PATH,
} from "@/modules/import/ui";

// The web app manifest (M3-P5, DR-0021). Served by Next at
// /manifest.webmanifest and linked from every page's head. It makes Pulse
// installable on the owner's Android phone, and once installed Pulse appears
// in the phone's share sheet for a PDF: the banking app exports a statement,
// the owner shares it to Pulse, and the file arrives at the share route.
//
// WHAT IS DELIBERATELY ABSENT. No theme_color and no background_color: both
// are literal colours, which CLAUDE.md non-negotiable 4 keeps out of source,
// and neither is needed to install. No service worker: current Chromium
// installs a site that has a manifest with a name, a start URL, a display
// mode and 192 and 512 pixel icons, without one, and the plan admits one
// only if installability measurably requires it (hazard H5.1), because a
// service worker is where caching, which the charter bans, gets in. That
// installability is Chromium's documented behaviour, NOT something this
// repository has measured: installing on the owner's own phone is owed
// evidence, recorded in delivery/work-history/m3-p5.yaml (fix round 1,
// finding CR-M3P5-02).
//
// The icons are generated from the design tokens by
// scripts/generate-app-icons.ts; the mark sits in the maskable safe zone, so
// each file serves both purposes.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulse",
    short_name: "Pulse",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: SHARE_TARGET_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: SHARE_TARGET_FILE_FIELD,
            accept: ["application/pdf", ".pdf"],
          },
        ],
      },
    },
  };
}
