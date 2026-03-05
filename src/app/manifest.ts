import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RelyBricks Admin",
    short_name: "RelyBricks",
    description: "RelyBricks property management admin portal",
    start_url: "/login",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/logo.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

