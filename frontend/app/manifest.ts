import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tripezium",
    short_name: "Tripezium",
    description: "Plan multi-city trips without the money headache.",
    start_url: "/",
    display: "standalone",
    background_color: "#e4eee8",
    theme_color: "#e4eee8",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  }
}
