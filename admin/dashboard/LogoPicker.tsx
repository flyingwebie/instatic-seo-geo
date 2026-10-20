import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Type } from "@sinclair/typebox";
import { usePluginRoutes } from "@instatic/host-hooks";
import { Alert, Button, Checkbox, SearchBar, Stack, Text, pushToast } from "@instatic/host-ui";
import { encodeLogo, prepareLogo } from "../../src/og/logo";
import type { Bitmap } from "../../src/og/raster";
import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, type OgTemplate } from "../../src/og/template";

type MediaAsset = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  thumb: string;
};

const SavedLogoSchema = Type.Object({ hash: Type.String(), width: Type.Integer(), height: Type.Integer() });

/** The admin media library, read with the signed-in user's session. */
async function listImages(): Promise<MediaAsset[]> {
  const response = await fetch("/admin/api/cms/media", { credentials: "include" });
  if (!response.ok) throw new Error(`The media library could not be loaded (HTTP ${response.status}).`);
  const body = (await response.json()) as { assets?: Array<Record<string, unknown>> };
  return (body.assets ?? [])
    .map((asset) => {
      const variants = Array.isArray(asset.variants)
        ? (asset.variants as Array<{ width?: number; path?: string }>).filter((v) => v.path)
        : [];
      const small = [...variants].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((v) => (v.width ?? 0) >= 160);
      const url = String(asset.publicPath ?? "");
      return {
        id: String(asset.id ?? url),
        name: String(asset.title || asset.filename || "Image"),
        mimeType: String(asset.mimeType ?? ""),
        url,
        thumb: small?.path ?? url,
        deleted: !!asset.deletedAt,
      };
    })
    .filter((asset) => asset.url && asset.mimeType.startsWith("image/") && !asset.deleted);
}

/** Decode any browser-supported image (PNG, JPEG, WebP, SVG…) into a logo bitmap. */
async function rasterize(src: string, removeWhite: boolean): Promise<Bitmap> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  // SVGs without intrinsic size report 0; give them a sensible canvas.
  let width = image.naturalWidth || 600;
  let height = image.naturalHeight || 240;
  // Fit the stored size, and upscale small logos so they stay crisp at 2×.
  const scale = Math.min(LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height, Math.max(1, 200 / height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare the logo.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  return prepareLogo({ width, height, data: new Uint8Array(pixels.data.buffer.slice(0)) }, removeWhite);
}

export function LogoPicker(props: {
  logo: OgTemplate["logo"];
  disabled: boolean;
  onPick: (logo: NonNullable<OgTemplate["logo"]>, bitmap: Bitmap) => void;
  onRemove: () => void;
}) {
  const routes = usePluginRoutes();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [removeWhite, setRemoveWhite] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || assets) return;
    let active = true;
    listImages()
      .then((list) => active && setAssets(list))
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "The media library could not be loaded."));
    return () => {
      active = false;
    };
  }, [open, assets]);

  const use = async (src: string, name: string) => {
    setWorking(true);
    try {
      const bitmap = await rasterize(src, removeWhite);
      const saved = await routes.json("/og-logo", SavedLogoSchema, {
        method: "POST",
        body: JSON.stringify({ name, width: bitmap.width, height: bitmap.height, data: encodeLogo(bitmap) }),
      });
      props.onPick({ hash: saved.hash, name: name.slice(0, 200), width: saved.width, height: saved.height }, bitmap);
      setOpen(false);
    } catch (reason) {
      pushToast({
        kind: "error",
        title: "The logo could not be used",
        body: reason instanceof Error ? reason.message : "Try another image.",
      });
    } finally {
      setWorking(false);
    }
  };

  const shown = (assets ?? []).filter((asset) => asset.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Stack gap={8}>
      <Stack direction="row" gap={8} wrap align="center">
        <Button variant="secondary" size="sm" disabled={props.disabled || working} onClick={() => setOpen(true)}>
          {props.logo ? "Change logo" : "Choose from media library"}
        </Button>
        <label
          style={{
            fontSize: "var(--text-s)",
            color: "var(--text-muted)",
            cursor: props.disabled ? "default" : "pointer",
            textDecoration: "underline",
          }}
        >
          Upload from computer
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={props.disabled || working}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              const url = URL.createObjectURL(file);
              void use(url, file.name).finally(() => URL.revokeObjectURL(url));
            }}
          />
        </label>
        {props.logo && (
          <Button variant="ghost" size="sm" disabled={props.disabled} onClick={props.onRemove}>
            Remove logo
          </Button>
        )}
      </Stack>
      <Checkbox
        label="Make a white background transparent (useful for JPG logos)"
        checked={removeWhite}
        onChange={setRemoveWhite}
      />
      {props.logo && <Text variant="muted">Using {props.logo.name}</Text>}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a logo"
            onClick={(event) => event.target === event.currentTarget && setOpen(false)}
            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgb(0 0 0 / 0.55)",
              display: "grid",
              placeItems: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                width: "min(880px, 100%)",
                maxHeight: "min(720px, 100%)",
                display: "grid",
                gridTemplateRows: "auto auto 1fr",
                gap: 12,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 20,
                boxShadow: "0 24px 64px rgb(0 0 0 / 0.4)",
              }}
            >
              <Stack direction="row" justify="between" align="center">
                <span style={{ fontSize: "var(--text-l)", color: "var(--text-bright)", fontWeight: 600 }}>
                  Choose a logo
                </span>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </Stack>
              <SearchBar value={query} onChange={setQuery} placeholder="Search images" />
              <div style={{ overflowY: "auto", minHeight: 200 }}>
                {error ? (
                  <Alert tone="warning" title="Media library unavailable">
                    {error} Use “Upload from computer” instead.
                  </Alert>
                ) : !assets ? (
                  <Text variant="muted">Loading images…</Text>
                ) : !shown.length ? (
                  <Text variant="muted">No images found. Upload your logo in Media first, or upload it from your computer.</Text>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                    {shown.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        disabled={working}
                        onClick={() => void use(asset.url, asset.name)}
                        title={asset.name}
                        style={{
                          display: "grid",
                          gap: 6,
                          padding: 8,
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          // Checkerboard shows transparency.
                          background:
                            "repeating-conic-gradient(var(--bg-surface-3) 0 25%, var(--bg-surface-2) 0 50%) 50% / 16px 16px",
                          cursor: working ? "wait" : "pointer",
                          color: "var(--text)",
                        }}
                      >
                        <img
                          src={asset.thumb}
                          alt=""
                          loading="lazy"
                          style={{ width: "100%", height: 90, objectFit: "contain" }}
                        />
                        <span
                          style={{
                            fontSize: "var(--text-xs)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            background: "var(--bg-surface)",
                            borderRadius: 4,
                            padding: "2px 4px",
                          }}
                        >
                          {asset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Stack>
  );
}
